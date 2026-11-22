/**
 * Where a duty GOES, from its route: every stop after the first, the return
 * to where it started left out — "WSSS-WIII-WSSS" is "WIII",
 * "WSSS-WMKK-VTBS-WSSS" "WMKK·VTBS".
 */
export function destinationOfRoute(route: string, code: (icao: string) => string = (x) => x): string {
  const stops = route.split(/[-\s]+/).filter(Boolean)
  if (stops.length < 2) return stops[0] ? code(stops[0]) : ""
  const away = stops.slice(1)
  if (away.length > 1 && away[away.length - 1] === stops[0]) away.pop()
  return [...new Set(away)].map(code).join("·")
}
