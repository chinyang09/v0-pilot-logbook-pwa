/**
 * Briefing packages, the NOTAM register and the route / airport notes
 * (`lib/briefing/`). Every id is DERIVED (`lib/briefing/ids.ts`), so a record
 * is written the way the settings record is: an UPDATE patch of the fields
 * that moved, from base 0 when this device holds no row yet — the server
 * inserts it if the account has none, and otherwise lays only those fields
 * over what other devices wrote. Two devices importing one PDF, or editing
 * one route's notes, merge instead of racing two creates.
 */

import type { Table } from "dexie"
import { userDb } from "../../user-db"
import type { BriefingNoteRecord, BriefingRecord, NotamRecord } from "@/types/entities/briefing.types"
import type { Briefing } from "@/lib/briefing/types"
import { briefingId, noteId, notamRecordId } from "@/lib/briefing/ids"
import { expiredRecords, registerChanges } from "@/lib/briefing/notams"
import { diffFields } from "@/lib/sync/changes"
import { purgeEntity, silentDeleteEntity, updateEntity, type SyncableEntity, type SyncableTableName } from "./crud-helpers"
import { addToSyncQueue, getDeviceId } from "./sync-queue.store"

/** Write these fields of a derived-id record, creating it as a patch from base 0 when it is not here yet. */
async function upsertDerived<T extends SyncableEntity>(
  table: Table<T, string>,
  name: SyncableTableName,
  id: string,
  patch: Partial<T>,
  defaults: Omit<T, "id" | "createdAt">,
): Promise<T> {
  const existing = await table.get(id)
  if (existing) return (await updateEntity<T>(table as unknown as Table<T>, name, id, patch)) ?? existing
  const now = Date.now()
  const row = {
    ...defaults,
    ...patch,
    id,
    createdAt: now,
    updatedAt: now,
    deviceId: await getDeviceId(),
    syncStatus: "pending",
  } as unknown as T
  await table.put(row)
  const fields = diffFields({ id } as never, row as never)
  await addToSyncQueue("update", name, row as never, { changedFields: fields, baseSeq: 0 })
  return row
}

/* ── briefings ───────────────────────────────────────────────────────────── */

export async function getBriefing(id: string): Promise<BriefingRecord | undefined> {
  const r = await userDb.briefings.get(id)
  return r && !r.deletedAt ? r : undefined
}

/**
 * Keep a parsed package — the flight's briefing, replaced whole by a newer
 * OFP — and fold its NOTAMs into the register. Answers the record and how
 * many of its NOTAMs the register had not seen.
 */
export async function saveBriefing(b: Briefing, fileName: string): Promise<{ record: BriefingRecord; newNotams: number }> {
  const id = briefingId(b.flight.number, b.flight.date, b.flight.dep)
  const now = Date.now()
  const fields: Omit<BriefingRecord, "id" | "createdAt"> = {
    flightNumber: b.flight.number,
    date: b.flight.date,
    dep: b.flight.dep,
    arr: b.flight.arr,
    registration: b.flight.registration,
    aircraftType: b.flight.aircraftType,
    ofpVersion: b.flight.ofpVersion,
    generatedAt: b.flight.generatedAtMs,
    importedAt: now,
    fileName,
    data: b,
  }
  const record = await upsertDerived<BriefingRecord>(userDb.briefings, "briefings", id, { ...fields, deletedAt: null }, fields)
  const newNotams = await foldIntoRegister(b, id, now)
  return { record, newNotams }
}

export async function deleteBriefing(id: string): Promise<boolean> {
  return purgeEntity(userDb.briefings, "briefings", id)
}

/* ── the NOTAM register ──────────────────────────────────────────────────── */

export async function getNotamRegister(): Promise<Map<string, NotamRecord>> {
  return new Map((await userDb.notams.toArray()).filter((r) => !r.deletedAt).map((r) => [r.id, r]))
}

async function foldIntoRegister(b: Briefing, id: string, now: number): Promise<number> {
  const existing = new Map((await userDb.notams.toArray()).map((r) => [r.id, r]))
  const { create, update } = registerChanges(b.notams.items, existing, id, now)
  const deviceId = await getDeviceId()
  if (create.length) {
    const rows = create.map((c) => ({ ...c, createdAt: now, updatedAt: now, deviceId, syncStatus: "pending" as const }))
    await userDb.notams.bulkPut(rows)
    for (const row of rows) {
      await addToSyncQueue("update", "notams", row, { changedFields: diffFields({ id: row.id } as never, row as never), baseSeq: 0 })
    }
  }
  for (const u of update) await updateEntity<NotamRecord>(userDb.notams, "notams", u.id, u.patch)
  // Housekeeping: what ended a week ago leaves the register (and every device).
  for (const r of expiredRecords(existing.values(), now)) await purgeEntity(userDb.notams, "notams", r.id)
  return create.length
}

/** Flag a NOTAM as one that matters, or take the flag off. */
export async function setNotamFlag(key: string, flagged: boolean): Promise<void> {
  await updateEntity<NotamRecord>(userDb.notams, "notams", notamRecordId(key), { flagged })
}

/* ── notes ───────────────────────────────────────────────────────────────── */

const NOTE_DEFAULTS = (scope: "route" | "airport", ref: string): Omit<BriefingNoteRecord, "id" | "createdAt"> => ({
  scope,
  ref: ref.toUpperCase(),
  procedures: null,
  frequencies: [],
  company: "",
  community: "",
  notes: "",
})

export async function getBriefingNote(scope: "route" | "airport", ref: string): Promise<BriefingNoteRecord | undefined> {
  const r = await userDb.briefingNotes.get(noteId(scope, ref))
  return r && !r.deletedAt ? r : undefined
}

export async function saveBriefingNote(
  scope: "route" | "airport",
  ref: string,
  patch: Partial<Pick<BriefingNoteRecord, "procedures" | "frequencies" | "company" | "community" | "notes">>,
): Promise<BriefingNoteRecord> {
  return upsertDerived<BriefingNoteRecord>(userDb.briefingNotes, "briefingNotes", noteId(scope, ref), patch, NOTE_DEFAULTS(scope, ref))
}

/* ── sync ────────────────────────────────────────────────────────────────── */

export const normalizeBriefingFromServer = (r: BriefingRecord): BriefingRecord => ({ ...r, syncStatus: "synced" })
export const normalizeNotamFromServer = (r: NotamRecord): NotamRecord => ({ ...r, syncStatus: "synced" })
export const normalizeBriefingNoteFromServer = (r: BriefingNoteRecord): BriefingNoteRecord => ({ ...r, syncStatus: "synced" })
export const silentDeleteBriefing = (id: string) => silentDeleteEntity<BriefingRecord>(userDb.briefings, id)
export const silentDeleteNotam = (id: string) => silentDeleteEntity<NotamRecord>(userDb.notams, id)
export const silentDeleteBriefingNote = (id: string) => silentDeleteEntity<BriefingNoteRecord>(userDb.briefingNotes, id)
