/**
 * Coordinate formatting utility
 */

type CoordinateFormat = "decimal" | "dms"

/**
 * Convert decimal degrees to DMS (Degrees Minutes Seconds) string
 */
function decimalToDMS(decimal: number, isLatitude: boolean): string {
  const absolute = Math.abs(decimal)
  const degrees = Math.floor(absolute)
  const minutesDecimal = (absolute - degrees) * 60
  const minutes = Math.floor(minutesDecimal)
  const seconds = Math.round((minutesDecimal - minutes) * 60)

  const direction = isLatitude
    ? decimal >= 0 ? "N" : "S"
    : decimal >= 0 ? "E" : "W"

  return `${degrees}\u00B0${minutes}\u2032${seconds}\u2033${direction}`
}

/**
 * Format latitude value
 */
export function formatLatitude(value: number, format: CoordinateFormat = "decimal"): string {
  if (format === "dms") {
    return decimalToDMS(value, true)
  }
  return value.toFixed(4)
}

/**
 * Format longitude value
 */
export function formatLongitude(value: number, format: CoordinateFormat = "decimal"): string {
  if (format === "dms") {
    return decimalToDMS(value, false)
  }
  return value.toFixed(4)
}

/**
 * Format a coordinate pair
 */
export function formatCoordinates(
  lat: number,
  lon: number,
  format: CoordinateFormat = "decimal"
): string {
  return `${formatLatitude(lat, format)}, ${formatLongitude(lon, format)}`
}
