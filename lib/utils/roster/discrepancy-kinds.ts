import type { Discrepancy } from "@/types/entities/roster.types"

/**
 * Discrepancy types that are a standing pilot-vs-company COMPARISON, not a
 * note to act on. They are kept on the record whichever way the pilot decided
 * (a licence submission is checked against them), so they are never
 * "resolved" — counting them as open import notes made the dashboard's bell
 * read "18" over changes the pilot had already approved.
 */
export const COMPARISON_TYPES: ReadonlySet<string> = new Set(["pilot_flying_mismatch", "day_night_mismatch"])

export const isComparison = (d: Pick<Discrepancy, "type">): boolean => COMPARISON_TYPES.has(d.type as string)

/** The import notes that still want the pilot: open, and not a comparison. */
export const openImportNotes = <T extends Pick<Discrepancy, "type" | "resolved">>(all: readonly T[]): T[] =>
  all.filter((d) => !d.resolved && !isComparison(d))
