/**
 * The first `limit` distinct keys met walking `items` in order — for the
 * "Recently Used" sections, which read the logbook (newest first) and keep the
 * crew, airports or aircraft it names. The crew, airports and aircraft pages
 * each carried their own copy of this loop.
 *
 * It stops as soon as it has `limit`, so on a long logbook it reads only the
 * last few flights. Empty keys are skipped; a key is compared as given, so a
 * caller that wants "9v-tnf" and "9V-TNF" to be one key normalises it in
 * `keysOf`.
 */
export function recentlyUsedKeys<T>(
  items: readonly T[],
  keysOf: (item: T) => readonly (string | null | undefined)[],
  limit = 10
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    for (const key of keysOf(item)) {
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(key)
      if (out.length >= limit) return out
    }
  }
  return out
}
