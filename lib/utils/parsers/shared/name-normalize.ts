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
