/**
 * String utilities.
 *
 * This file used to hold twelve exports. Eleven of them had no caller —
 * `normalizeForComparison` was reached only by two dead helpers, and
 * `truncate` looked live because every hit was Tailwind's `truncate` CLASS
 * rather than a call. What is left is the one that is genuinely load-bearing,
 * and every importer in the repo asks for exactly it.
 */

/**
 * Canonical aircraft-registration key for dedup and lookup matching.
 *
 * Uppercases and strips EVERY non-alphanumeric character, so "VH-ABC",
 * "vh abc" and "VHABC" all collapse to the same key. This must be identical
 * on the client (local IndexedDB matching) and the server (the submission
 * dedup key `registrationNormalized`) — diverging forms cause lookup misses
 * and duplicate submissions. Keep this the single source of truth.
 */
export function normalizeRegistration(reg: string): string {
  return reg ? reg.toUpperCase().replace(/[^A-Z0-9]/g, "") : ""
}
