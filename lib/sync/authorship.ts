/**
 * Last-write-wins ordering — PURE, shared by the client and the server.
 *
 * Both ends must agree on which of two versions of a record wins, or a device
 * keeps a version the server threw away (and vice versa). It used to be two
 * copies: one in `crud-helpers.ts`, one inside `/api/sync/bulk`. One function
 * now, imported by both.
 */

export interface Authored {
  createdAt?: number | null
  updatedAt?: number | null
  deviceId?: string | null
}

/** Coerce a timestamp-ish value to a finite number (kills LWW type confusion). */
export function toTimestamp(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v)
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.getTime()
  return undefined
}

/**
 * Deterministic last-write-wins comparison. Orders by (updatedAt, deviceId) so
 * two concurrent edits with the same timestamp resolve identically on every
 * device instead of "whoever the server saw last" / "server always wins".
 * Returns > 0 if `a` wins, < 0 if `b` wins, 0 if identical authorship.
 */
export function compareAuthorship(a: Authored, b: Authored): number {
  const at = toTimestamp(a.updatedAt) ?? toTimestamp(a.createdAt) ?? 0
  const bt = toTimestamp(b.updatedAt) ?? toTimestamp(b.createdAt) ?? 0
  if (at !== bt) return at - bt
  const ad = typeof a.deviceId === "string" ? a.deviceId : ""
  const bd = typeof b.deviceId === "string" ? b.deviceId : ""
  return ad < bd ? -1 : ad > bd ? 1 : 0
}
