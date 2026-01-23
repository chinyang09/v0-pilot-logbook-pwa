/**
 * Date formatting utilities
 * Centralized date formatting functions to reduce code duplication
 */

/**
 * Month abbreviations (uppercase)
 */
export const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const

/**
 * Month abbreviations (title case)
 */
export const MONTHS_TITLE_CASE = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/**
 * Weekday abbreviations (3-letter)
 */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

/**
 * Weekday abbreviations (1-letter)
 */
export const WEEKDAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"] as const

/**
 * Parse a YYYY-MM-DD date string to a local Date object
 * Handles 2-digit year format (YY) by assuming 2000s
 * Returns current date as fallback for invalid input
 */
export function parseDateLocal(dateStr: string): Date {
  if (!dateStr || typeof dateStr !== "string") {
    return new Date()
  }

  const parts = dateStr.split("-")
  if (parts.length !== 3) {
    return new Date()
  }

  let year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])

  // Handle 2-digit year (YY format) - assume 2000s
  if (year < 100) {
    year = 2000 + year
  }

  // Validate parsed values
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return new Date()
  }

  return new Date(year, month - 1, day)
}

/**
 * Format a Date object to YYYY-MM-DD string
 */
export function formatDateLocal(date: Date): string {
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, "0")
  const day = date.getDate().toString().padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * Format date for display using native toLocaleDateString
 * @param date - Date object or YYYY-MM-DD string
 * @param options - Intl.DateTimeFormatOptions
 */
export function formatDateDisplay(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }
): string {
  const dateObj = typeof date === "string" ? parseDateLocal(date) : date
  return dateObj.toLocaleDateString(undefined, options)
}

/**
 * Format date as "DD MMM YY" (e.g., "15 JAN 24")
 */
export function formatDateShort(date: Date | string): string {
  const dateObj = typeof date === "string" ? parseDateLocal(date) : date
  const day = dateObj.getDate().toString().padStart(2, "0")
  const month = MONTHS[dateObj.getMonth()]
  const year = dateObj.getFullYear().toString().slice(2)
  return `${day} ${month} ${year}`
}

/**
 * Format date as "Mon, Jan 15, 2024"
 */
export function formatDateLong(date: Date | string): string {
  return formatDateDisplay(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/**
 * Format date as "January 2024" (month and year only)
 */
export function formatMonthYear(date: Date | string): string {
  return formatDateDisplay(date, {
    month: "long",
    year: "numeric",
  })
}

/**
 * Get ISO date string (YYYY-MM-DD) from Date
 * Uses UTC to avoid timezone issues
 */
export function toISODateString(date: Date): string {
  return date.toISOString().split("T")[0]
}

/**
 * Get current date as YYYY-MM-DD string (local time)
 */
export function getTodayLocal(): string {
  return formatDateLocal(new Date())
}

/**
 * Parse DD/MM/YYYY format to YYYY-MM-DD
 */
export function parseDDMMYYYY(dateStr: string): string {
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return ""
  const [, dd, mm, yyyy] = match
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`
}

/**
 * Check if a date string is valid YYYY-MM-DD format
 */
export function isValidDateString(dateStr: string | undefined | null): boolean {
  if (!dateStr || typeof dateStr !== "string") return false
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)

  // Basic validation
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  if (year < 1900 || year > 2100) return false

  return true
}

/**
 * Extract date components from Date object
 */
export function getDateComponents(date: Date): {
  day: string
  month: string
  monthIndex: number
  year: string
  fullYear: number
  weekday: string
  weekdayShort: string
} {
  return {
    day: date.getDate().toString().padStart(2, "0"),
    month: MONTHS[date.getMonth()],
    monthIndex: date.getMonth(),
    year: date.getFullYear().toString().slice(2),
    fullYear: date.getFullYear(),
    weekday: WEEKDAYS[date.getDay()],
    weekdayShort: WEEKDAYS_SHORT[date.getDay()],
  }
}
