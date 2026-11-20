/**
 * Great-circle geometry, in nautical miles — the distance to a destination,
 * and how far an airport lies off a leg (cross-track) and along it
 * (along-track), for the alternates along a route.
 */

export interface LatLon {
  lat: number
  lon: number
}

/** The earth's mean radius, nm. */
const R_NM = 3440.065
const rad = (d: number) => (d * Math.PI) / 180

/** Central angle between two points, radians. */
function angle(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function greatCircleNm(a: LatLon, b: LatLon): number {
  return angle(a, b) * R_NM
}

/** Initial true course from `a` to `b`, degrees. */
export function initialCourse(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * Where `p` lies against the great circle `a`→`b`: how far off it (always
 * positive) and how far along it from `a` (negative behind `a`).
 */
export function offTrack(p: LatLon, a: LatLon, b: LatLon): { crossNm: number; alongNm: number } {
  const d13 = angle(a, p)
  const t13 = rad(initialCourse(a, p))
  const t12 = rad(initialCourse(a, b))
  const xt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12))
  const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(xt))))
  const behind = Math.cos(t13 - t12) < 0
  return { crossNm: Math.abs(xt) * R_NM, alongNm: (behind ? -at : at) * R_NM }
}
