/**
 * Strip everything except [a-z0-9] and lowercase. Used to compare crew names
 * across CSV/PDF sources where punctuation, casing, and spacing vary.
 *
 * "Kenneth Albert Steph" → "kennethalbertsteph"
 * "Wong, Chung Yoong, Kl" → "wongchungyoongkl"
 */
export function normalize(s: string): string {
  return s ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

/**
 * Two crew names refer to the same person when their normalized forms are
 * equal OR one is a prefix of the other (the Crew Logbook Report truncates
 * names to 20 chars; the Schedule Report carries the full form).
 */
export function isSamePersonName(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > nb.length && na.startsWith(nb)) return true;
  if (nb.length > na.length && nb.startsWith(na)) return true;
  return false;
}
