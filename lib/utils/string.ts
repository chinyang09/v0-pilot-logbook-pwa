/**
 * String utility functions
 * Centralized string manipulation helpers
 */

/**
 * Normalize a string for comparison purposes
 * Converts to lowercase and removes all non-alphanumeric characters
 * Useful for matching names with different formatting
 */
export function normalizeForComparison(str: string): string {
  return str ? str.toLowerCase().replace(/[^a-z0-9]/g, "") : ""
}

/**
 * Normalize an IATA/ICAO code
 * Converts to uppercase and trims whitespace
 */
export function normalizeAirportCode(code: string): string {
  return code ? code.trim().toUpperCase() : ""
}

/**
 * Normalize an aircraft registration
 * Converts to uppercase and trims whitespace
 */
export function normalizeRegistration(reg: string): string {
  return reg ? reg.trim().toUpperCase() : ""
}

/**
 * Clean a CSV field value
 * Removes surrounding quotes and trims whitespace
 */
export function cleanCsvField(value: string): string {
  return value ? value.replace(/^"|"$/g, "").trim() : ""
}

/**
 * Extract numeric part from a string
 * Useful for comparing flight numbers with different prefixes
 */
export function extractNumeric(str: string): string {
  return str ? str.replace(/\D/g, "") : ""
}

/**
 * Check if two strings match when normalized
 */
export function normalizedEquals(a: string, b: string): boolean {
  return normalizeForComparison(a) === normalizeForComparison(b)
}

/**
 * Check if normalized string a starts with normalized string b
 */
export function normalizedStartsWith(str: string, prefix: string): boolean {
  return normalizeForComparison(str).startsWith(normalizeForComparison(prefix))
}

/**
 * Clean time string by removing non-digit/colon characters
 */
export function cleanTimeString(time: string): string {
  return time ? time.replace(/[^\d:]/g, "") : ""
}

/**
 * Remove unicode superscript markers (like ⁺¹) from strings
 */
export function removeUnicodeMarkers(str: string): string {
  return str ? str.replace(/[⁺¹]/g, "").trim() : ""
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) return str
  return `${str.slice(0, maxLength - 1)}…`
}

/**
 * Capitalize first letter of each word
 */
export function titleCase(str: string): string {
  if (!str) return ""
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Convert a name to initials (e.g., "John Smith" -> "JS")
 */
export function getInitials(name: string, maxChars = 2): string {
  if (!name) return ""
  return name
    .split(" ")
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, maxChars)
}
