/**
 * Pure halves of the server sync engine — no MongoDB import, so they are
 * unit-testable on their own. `engine.ts` does the IO around them.
 */

import type { SyncCollection } from "@/types/sync/sync.types"
import { compareAuthorship, toTimestamp } from "../authorship"
import { isSyncCollection } from "../schema"
import { diffFields, sameValue } from "../changes"

export interface PushItem {
  id: string
  type: "create" | "update" | "delete"
  timestamp: number
  collection: SyncCollection
  data: Record<string, unknown> & { id: string }
  retryCount?: number
  /** Fields this push changes; absent = the whole record (last-write-wins). */
  changedFields?: string[]
  /** The server version the edit was made against. */
  baseSeq?: number
}

export interface PushItemResult {
  queueItemId: string
  success: boolean
  /** The record was purged on another device — delete it locally. */
  rejected?: boolean
  /** The server already holds a NEWER version; `record` carries it. */
  stale?: boolean
  /**
   * The record as it now stands, when it differs from what the client sent —
   * another device changed other fields, or a field conflict went the other
   * way. The client rebases its copy onto it.
   */
  record?: Record<string, unknown>
  /** The seq this push was written at (absent when nothing was written). */
  serverSeq?: number
  /** Fields edited on two devices since their common base. */
  conflicts?: { field: string; winner: "incoming" | "server" }[]
  reason?: string
}

const MAX_ID_LENGTH = 200
const MAX_FIELDS = 500

/**
 * Validate and bucket a pushed batch by collection. An invalid item is poison:
 * reported as a failure (the client dead-letters it after its retries) rather
 * than silently dropped.
 */
export function validatePushItems(raw: unknown[]): {
  byCollection: Map<SyncCollection, PushItem[]>
  invalid: PushItemResult[]
} {
  const byCollection = new Map<SyncCollection, PushItem[]>()
  const invalid: PushItemResult[] = []
  for (const item of raw as Partial<PushItem>[]) {
    const data = item?.data as { id?: unknown } | undefined
    const ok =
      !!item &&
      typeof item.id === "string" &&
      (item.type === "create" || item.type === "update" || item.type === "delete") &&
      isSyncCollection(item.collection) &&
      !!data &&
      typeof data === "object" &&
      typeof data.id === "string" &&
      data.id.length > 0 &&
      data.id.length <= MAX_ID_LENGTH
    const fields = (item as { changedFields?: unknown } | null)?.changedFields
    const fieldsOk =
      fields === undefined ||
      (Array.isArray(fields) && fields.length <= MAX_FIELDS && fields.every((f) => typeof f === "string" && f.length <= 100))
    const base = (item as { baseSeq?: unknown } | null)?.baseSeq
    const baseOk = base === undefined || (typeof base === "number" && Number.isFinite(base) && base >= 0)
    if (!ok || !fieldsOk || !baseOk) {
      invalid.push({
        queueItemId: typeof item?.id === "string" ? item.id : "unknown",
        success: false,
        reason: "Invalid sync item",
      })
      continue
    }
    const list = byCollection.get(item.collection as SyncCollection) ?? []
    list.push(item as PushItem)
    byCollection.set(item.collection as SyncCollection, list)
  }
  return { byCollection, invalid }
}

export type PushDecision = "insert" | "update" | "patch" | "delete" | "stale" | "rejected"

/**
 * What to do with one pushed item, given what the server holds.
 *
 * - a delete always applies (tombstone first, then the record)
 * - a write for a TOMBSTONED id is rejected — it was purged elsewhere, and
 *   re-creating it would resurrect it on every device
 * - a write for a record the server doesn't have is an insert
 * - an update that says which fields it changed is a PATCH (field-level
 *   merge, `applyFieldPatch`) — the normal case for a current client
 * - otherwise (a whole-record write from an older build) last-write-wins by
 *   (updatedAt, deviceId); an equal or older version is `stale`
 */
export function decidePush(
  item: PushItem,
  existing: Record<string, unknown> | undefined,
  tombstoned: boolean
): PushDecision {
  if (item.type === "delete") return "delete"
  if (tombstoned) return "rejected"
  if (!existing) return "insert"
  if (item.type === "update" && Array.isArray(item.changedFields)) return "patch"
  return compareAuthorship(item.data as never, existing as never) > 0 ? "update" : "stale"
}

/** Who last changed a field, at which seq and when (server bookkeeping). */
export interface FieldVersion {
  seq: number
  at: number
  by: string
}
export type FieldVersions = Record<string, FieldVersion>

export interface FieldConflict {
  field: string
  winner: "incoming" | "server"
  /** The value that LOST — kept in `syncConflicts` so it can be put back. */
  discarded: unknown
  kept: unknown
  serverBy: string
  serverAt: number
  incomingBy: string
  incomingAt: number
}

/** Fields a patch may never touch — identity and server bookkeeping. */
const UNPATCHABLE = new Set([
  "id", "userId", "createdAt", "updatedAt", "deviceId", "syncStatus",
  "serverSeq", "syncedAt", "schemaVersion", "fieldVersions", "_id",
])

export function readFieldVersions(doc: Record<string, unknown> | undefined): FieldVersions {
  const raw = doc?.fieldVersions
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as FieldVersions) } : {}
}

/**
 * Apply a field-level edit onto the stored document.
 *
 * For each field the client changed:
 * - nobody else changed it since the client's base → take the client's value
 * - ANOTHER device changed it since that base, to a different value → a
 *   genuine conflict: the later edit wins (device id breaks a tie), and the
 *   losing value is returned so it can be recorded
 *
 * A change since the base made by the SAME device is its own history (an edit
 * whose push was confirmed before this one was queued), not a conflict.
 *
 * Every other field keeps the stored value — which is the whole point: a
 * device that had not caught up no longer reverts what it never saw.
 */
export function applyFieldPatch(args: {
  existing: Record<string, unknown>
  incoming: Record<string, unknown>
  fields: string[]
  baseSeq: number
  deviceId: string
  editedAt: number
  seq: number
}): {
  doc: Record<string, unknown>
  fieldVersions: FieldVersions
  applied: string[]
  conflicts: FieldConflict[]
  /** Another device changed SOMETHING since the base — the client's copy is behind. */
  concurrent: boolean
} {
  const { existing, incoming, baseSeq, deviceId, editedAt, seq } = args
  const doc: Record<string, unknown> = { ...existing }
  const fieldVersions = readFieldVersions(existing)
  const applied: string[] = []
  const conflicts: FieldConflict[] = []

  const concurrent = Object.values(fieldVersions).some((v) => v && v.seq > baseSeq && v.by !== deviceId)

  for (const field of [...new Set(args.fields)]) {
    if (UNPATCHABLE.has(field)) continue
    const next = incoming[field]
    if (sameValue(existing[field], next)) continue

    const version = fieldVersions[field]
    const contested = !!version && version.seq > baseSeq && version.by !== deviceId
    let take = true
    if (contested) {
      const incomingWins = editedAt !== version.at ? editedAt > version.at : deviceId > version.by
      take = incomingWins
      conflicts.push({
        field,
        winner: incomingWins ? "incoming" : "server",
        discarded: incomingWins ? existing[field] ?? null : next ?? null,
        kept: incomingWins ? next ?? null : existing[field] ?? null,
        serverBy: version.by,
        serverAt: version.at,
        incomingBy: deviceId,
        incomingAt: editedAt,
      })
    }
    if (!take) continue
    if (next === undefined) delete doc[field]
    else doc[field] = next
    fieldVersions[field] = { seq, at: editedAt, by: deviceId }
    applied.push(field)
  }

  return { doc, fieldVersions, applied, conflicts, concurrent }
}

/**
 * Field versions after a whole-record write (insert or last-write-wins
 * update): every field whose value moved is stamped with this write.
 */
export function stampChangedFields(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  stamp: FieldVersion
): FieldVersions {
  const versions = readFieldVersions(existing)
  if (!existing) return versions
  for (const field of diffFields(existing, next)) versions[field] = stamp
  return versions
}

/** How far ahead of the server a device's clock is believed for a tiebreak. */
export const MAX_CLOCK_LEAD_MS = 5 * 60 * 1000

/**
 * The authoring device's edit time for a pushed item — used only to settle a
 * same-field conflict. Capped a few minutes past the server's clock: a device
 * whose clock runs hours fast would otherwise win every conflict it is part
 * of until real time caught up.
 */
export function editTime(item: PushItem, now: number): number {
  const at = toTimestamp(item.data.updatedAt) ?? now
  return Math.min(at, now + MAX_CLOCK_LEAD_MS)
}

/**
 * If a batch carries more than one item for the same record (it shouldn't —
 * the client compacts — but a hand-rolled or older client might), keep only
 * the LAST, and report the earlier ones as succeeded without writing them.
 * Two writes to one document in one bulkWrite would otherwise race on the
 * same seq block.
 */
export function dedupeByRecord(items: PushItem[]): { kept: PushItem[]; superseded: PushItem[] } {
  const lastIndex = new Map<string, number>()
  items.forEach((item, i) => lastIndex.set(item.data.id, i))
  const kept: PushItem[] = []
  const superseded: PushItem[] = []
  items.forEach((item, i) => (lastIndex.get(item.data.id) === i ? kept : superseded).push(item))
  return { kept, superseded }
}

/** Key for "this request wrote this record at this seq". */
export const writtenKey = (collection: SyncCollection, id: string) => `${collection}:${id}`
