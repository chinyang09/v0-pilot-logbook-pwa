/**
 * Field-level change tracking — PURE, shared by the client and the server.
 *
 * Why the sync is field-level and not whole-record last-write-wins:
 *
 * A device that has not caught up holds an OLD copy of a record. If the pilot
 * edits one field on it and the whole record is pushed, every other field goes
 * with it — and the server, comparing timestamps, sees a NEWER record and
 * takes all of it. Whatever another device changed in the meantime is quietly
 * reverted to the stale copy. That is the "corrupts the data" case.
 *
 * So an edit carries what it actually is:
 *
 *   changedFields — the fields this device changed (union across the edits
 *                   collapsed into one queue row)
 *   baseSeq       — the server version (`serverSeq`) the device's copy was at
 *                   when the first of those edits was made
 *
 * and the server applies ONLY those fields onto its current document. Two
 * devices editing different fields of one flight both keep their edit. Only
 * the same field edited on two devices since their common base is a genuine
 * conflict; that one is settled by the later edit, and the value that lost is
 * recorded rather than discarded (`syncConflicts`).
 *
 * In the other direction, a pulled record is REBASED under any edit still
 * waiting to go up, instead of the two being compared by clock: the server's
 * copy is the truth, with this device's pending fields laid over it.
 */

/** Bookkeeping keys that never count as a change to the record itself. */
const META_KEYS = new Set([
  "id",
  "userId",
  "createdAt",
  "updatedAt",
  "deviceId",
  "syncStatus",
  "serverSeq",
  "syncedAt",
  "schemaVersion",
  "fieldVersions",
  "_id",
])

function stable(value: unknown): string {
  // Absent, undefined and null all mean "no value" across the wire — and so
  // does an EMPTY list or object. The canonical shape writes a missing list as
  // `[]` and a form may hand back `undefined` for the same nothing; counted as
  // different, every save of a crew card "changed" its roles and contact, and
  // a real edit to them on another device became a spurious conflict.
  if (value === undefined || value === null) return "∅"
  if (Array.isArray(value) && value.length === 0) return "∅"
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 0) {
    return "∅"
  }
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v
  )
}

/** Deep value equality as the sync sees it (null ≡ undefined ≡ absent). */
export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

/** The record fields whose value differs between two versions of a record. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const key of keys) {
    if (META_KEYS.has(key)) continue
    if (!sameValue(before[key], after[key])) changed.push(key)
  }
  return changed.sort()
}

/**
 * Combine the field sets of two edits collapsed into one queue row.
 * `undefined` means "the whole record" (a create, or a write whose fields are
 * unknown), and absorbs anything it is combined with.
 */
export function unionFields(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (a === undefined || b === undefined) return undefined
  return [...new Set([...a, ...b])].sort()
}

/** The earlier of two bases — a collapsed row is based where its FIRST edit was. */
export function earlierBase(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

/**
 * The server's record with this device's pending fields laid over it.
 *
 * The bookkeeping that describes the LOCAL edit (its `updatedAt`, `deviceId`,
 * pending status) is kept, so the row still reads as an unpushed edit; the
 * `serverSeq` is the server's, so the next edit is based on what this device
 * has now actually seen.
 */
export function rebaseOnServer<T extends Record<string, unknown>>(server: T, local: T, fields: string[]): T {
  const out: Record<string, unknown> = { ...server }
  for (const field of fields) {
    if (local[field] === undefined) delete out[field]
    else out[field] = local[field]
  }
  out.updatedAt = local.updatedAt
  out.deviceId = local.deviceId
  out.syncStatus = local.syncStatus ?? "pending"
  return out as T
}
