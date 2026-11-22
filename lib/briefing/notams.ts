/**
 * The pilot's NOTAM REGISTER — what they have already read, and which ones
 * they marked as mattering (the owner, Nov 2026):
 *
 * - "all notams to be parsed and made available, and then I will select those
 *   of importance, and they will be kept through its validity"
 * - "when a new PDF is imported again, those that are checked will remain; if
 *   there's an update of validity or period while info remains the same, it
 *   continues to be checked"
 * - "those not checked will still be available but stowed away"
 * - "if there are new ones, to be highlighted so it is easier to pick up"
 * - an airport this flight goes TO may be another flight's ALTERNATE: what
 *   was flagged for it once is flagged wherever it appears.
 *
 * So a NOTAM is known by WHAT IT SAYS WHERE (`Notam.key` — the location and
 * its words without the number, the "VALIDITY:" line or the schedule), not by
 * its number: a re-issue under a new number, or new dates, is the same
 * NOTAM. One register record per key (`notam:<key>`), synced, holding the
 * flag, the briefing it first came in with, and its latest validity. Pure.
 */

import type { Notam } from "./types"
import type { NotamRecord } from "@/types/entities/briefing.types"
import { notamRecordId } from "./ids"

/** A register record past its validity by this long is dropped (a flag outlives its NOTAM by no more). */
export const NOTAM_KEEP_AFTER_MS = 7 * 86_400_000

/**
 * What an import writes to the register: a whole record for a NOTAM never
 * seen, and for one already there only what moved — its number, its dates,
 * its schedule and when it was last seen. The flag is never touched.
 */
export function registerChanges(
  items: Notam[],
  existing: ReadonlyMap<string, NotamRecord>,
  briefingId: string,
  now: number,
): { create: Omit<NotamRecord, "createdAt" | "syncStatus">[]; update: { id: string; patch: Partial<NotamRecord> }[] } {
  const create: Omit<NotamRecord, "createdAt" | "syncStatus">[] = []
  const update: { id: string; patch: Partial<NotamRecord> }[] = []
  const seen = new Set<string>()
  for (const n of items) {
    if (seen.has(n.key)) continue
    seen.add(n.key)
    const id = notamRecordId(n.key)
    const old = existing.get(id)
    if (!old) {
      create.push({
        id,
        key: n.key,
        notamId: n.id,
        location: n.location,
        locationName: n.locationName,
        category: n.category,
        section: n.section,
        fromMs: n.fromMs,
        toMs: n.toMs,
        toText: n.toText,
        schedule: n.schedule,
        limits: n.limits,
        text: n.text,
        flagged: false,
        firstBriefingId: briefingId,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      continue
    }
    const patch: Partial<NotamRecord> = {}
    if (old.notamId !== n.id) patch.notamId = n.id
    if (old.fromMs !== n.fromMs) patch.fromMs = n.fromMs
    if (old.toMs !== n.toMs) patch.toMs = n.toMs
    if (old.toText !== n.toText) patch.toText = n.toText
    if (old.schedule !== n.schedule) patch.schedule = n.schedule
    if (old.limits !== n.limits) patch.limits = n.limits
    if (old.deletedAt) patch.deletedAt = null
    // Last seen moves only by a day or more, so re-opening a briefing does not write.
    if (now - old.lastSeenAt > 86_400_000) patch.lastSeenAt = now
    if (Object.keys(patch).length) update.push({ id, patch })
  }
  return { create, update }
}

/** Register records whose validity ended more than `NOTAM_KEEP_AFTER_MS` ago. */
export function expiredRecords(records: Iterable<NotamRecord>, now: number): NotamRecord[] {
  return [...records].filter((r) => r.toMs !== null && r.toMs < now - NOTAM_KEEP_AFTER_MS)
}

export type NotamStatus = "flagged" | "new" | "known"

/** One NOTAM as a briefing shows it: the bulletin's copies of it folded into one. */
export interface NotamView {
  key: string
  /** Every number it appears under in this bulletin ("1A4401/26", "1A3499/26"). */
  ids: string[]
  notam: Notam
  status: NotamStatus
}

/** A location's NOTAMs, flagged first, then new, then the rest. */
export interface NotamGroup {
  location: string
  locationName: string
  section: string
  flagged: NotamView[]
  fresh: NotamView[]
  known: NotamView[]
}

/** Each NOTAM's status in THIS briefing. Not in the register (never imported) reads as new. */
export function statusOf(n: Notam, register: ReadonlyMap<string, NotamRecord>, briefingId: string): NotamStatus {
  const r = register.get(notamRecordId(n.key))
  if (r?.flagged) return "flagged"
  if (!r || r.firstBriefingId === briefingId) return "new"
  return "known"
}

/** The bulletin as locations, in its own order, each split flagged / new / known. */
export function groupNotams(items: Notam[], register: ReadonlyMap<string, NotamRecord>, briefingId: string): NotamGroup[] {
  const groups = new Map<string, NotamGroup>()
  const views = new Map<string, NotamView>()
  for (const n of items) {
    const g = groups.get(n.location) ?? { location: n.location, locationName: n.locationName, section: n.section, flagged: [], fresh: [], known: [] }
    groups.set(n.location, g)
    const v = views.get(n.key)
    if (v) {
      if (!v.ids.includes(n.id)) v.ids.push(n.id)
      continue
    }
    const view: NotamView = { key: n.key, ids: [n.id], notam: n, status: statusOf(n, register, briefingId) }
    views.set(n.key, view)
    ;(view.status === "flagged" ? g.flagged : view.status === "new" ? g.fresh : g.known).push(view)
  }
  return [...groups.values()]
}

/** How many NOTAMs a briefing carries in each status, its copies counted once. */
export function notamCounts(groups: NotamGroup[]): Record<NotamStatus, number> & { total: number } {
  const c = { flagged: 0, new: 0, known: 0, total: 0 }
  for (const g of groups) {
    c.flagged += g.flagged.length
    c.new += g.fresh.length
    c.known += g.known.length
  }
  c.total = c.flagged + c.new + c.known
  return c
}

