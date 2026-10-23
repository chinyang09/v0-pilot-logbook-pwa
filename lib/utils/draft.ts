/**
 * An edit form's DRAFT: only the fields the user has touched, laid over the
 * live record.
 *
 * A form that copies the record into state when it opens holds a stale copy
 * from the first pull after that, and saving it sends the stale values back
 * over another device's edit (the flight form's `formPatch`/`rebaseForm` exist
 * for exactly that). Holding the edits alone makes the rule structural: every
 * field the user has not touched IS the record, whatever arrives underneath.
 */

/** The record with the user's edits laid over it. */
export function draftValues<T extends object>(base: T, edits: Partial<T>): T {
  return { ...base, ...edits }
}

/** Whether any edit actually differs from the record it was made against. */
export function draftDirty<T extends object>(base: T, edits: Partial<T>): boolean {
  return (Object.keys(edits) as (keyof T)[]).some((k) => edits[k] !== base[k])
}
