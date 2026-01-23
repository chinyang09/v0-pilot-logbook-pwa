/**
 * Time utility functions for HH:MM format storage
 * All times are stored as "HH:MM" strings for accurate post-processing
 */

/**
 * Convert decimal hours to HH:MM string
 */
export function decimalToHHMM(decimal: number): string {
  if (!decimal || decimal <= 0 || !Number.isFinite(decimal)) return "00:00"
  const hours = Math.floor(decimal)
  const minutes = Math.round((decimal - hours) * 60)
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
}

/**
 * Convert HH:MM string to decimal hours
 */
export function hhmmToDecimal(hhmm: string | undefined | null): number {
  if (!hhmm || typeof hhmm !== "string") return 0
  const parts = hhmm.split(":")
  if (parts.length !== 2) return 0
  const hours = Number.parseInt(parts[0], 10)
  const minutes = Number.parseInt(parts[1], 10)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0
  return hours + minutes / 60
}

/**
 * Convert HH:MM string to total minutes
 */
export function hhmmToMinutes(hhmm: string | undefined | null): number {
  if (!hhmm || typeof hhmm !== "string") return 0
  const parts = hhmm.split(":")
  if (parts.length !== 2) return 0
  const hours = Number.parseInt(parts[0], 10)
  const minutes = Number.parseInt(parts[1], 10)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0
  return hours * 60 + minutes
}

/**
 * Convert total minutes to HH:MM string
 */
export function minutesToHHMM(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0 || !Number.isFinite(totalMinutes)) return "00:00"
  const hours = Math.floor(totalMinutes / 60)
  const minutes = Math.round(totalMinutes % 60)
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
}

/**
 * Add two HH:MM times together
 */
export function addHHMM(time1: string | undefined | null, time2: string | undefined | null): string {
  const mins1 = hhmmToMinutes(time1)
  const mins2 = hhmmToMinutes(time2)
  return minutesToHHMM(mins1 + mins2)
}

/**
 * Subtract HH:MM times (time1 - time2)
 */
export function subtractHHMM(time1: string | undefined | null, time2: string | undefined | null): string {
  const mins1 = hhmmToMinutes(time1)
  const mins2 = hhmmToMinutes(time2)
  return minutesToHHMM(Math.max(0, mins1 - mins2))
}

/**
 * Calculate difference between two HH:MM times (for same day)
 * Handles overnight flights automatically
 * Returns HH:MM format
 */
export function calculateDuration(
  startTime: string | undefined | null,
  endTime: string | undefined | null
): string {
  if (!startTime || !endTime) return "00:00"

  const startMins = hhmmToMinutes(startTime)
  let endMins = hhmmToMinutes(endTime)

  // Handle overnight (if end is before start, add 24 hours)
  if (endMins < startMins) {
    endMins += 24 * 60
  }

  return minutesToHHMM(endMins - startMins)
}

/**
 * Format HH:MM for display (e.g., "2:30" or "12:45")
 * No leading zero on hours
 */
export function formatHHMMDisplay(hhmm: string | undefined | null): string {
  if (!hhmm || typeof hhmm !== "string") return "0:00"
  const parts = hhmm.split(":")
  if (parts.length !== 2) return "0:00"
  const hours = Number.parseInt(parts[0], 10)
  const minutes = parts[1]
  if (Number.isNaN(hours)) return "0:00"
  return `${hours}:${minutes}`
}

/**
 * Format time as H:MM (no leading zero on hours)
 * @alias formatHHMMDisplay
 */
export const formatTimeShort = formatHHMMDisplay

/**
 * Sum an array of HH:MM strings
 */
export function sumHHMM(times: (string | undefined | null)[]): string {
  const totalMinutes = times.reduce((sum, time) => sum + hhmmToMinutes(time), 0)
  return minutesToHHMM(totalMinutes)
}

/**
 * Check if a time string is valid HH:MM format
 */
export function isValidHHMM(time: string | undefined | null): boolean {
  if (!time || typeof time !== "string") return false
  const match = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return false
  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

/**
 * Convert UTC time (HH:MM) to local time given timezone offset in hours
 */
export function utcToLocal(utcTime: string | undefined | null, timezoneOffset: number): string {
  if (!utcTime || !isValidHHMM(utcTime)) return ""

  const utcMinutes = hhmmToMinutes(utcTime)
  let localMinutes = utcMinutes + timezoneOffset * 60

  // Handle day wraparound
  if (localMinutes < 0) localMinutes += 24 * 60
  if (localMinutes >= 24 * 60) localMinutes -= 24 * 60

  return minutesToHHMM(localMinutes)
}

/**
 * Convert local time (HH:MM) to UTC given timezone offset in hours
 */
export function localToUtc(localTime: string | undefined | null, timezoneOffset: number): string {
  if (!localTime || !isValidHHMM(localTime)) return ""

  const localMinutes = hhmmToMinutes(localTime)
  let utcMinutes = localMinutes - timezoneOffset * 60

  // Handle day wraparound
  if (utcMinutes < 0) utcMinutes += 24 * 60
  if (utcMinutes >= 24 * 60) utcMinutes -= 24 * 60

  return minutesToHHMM(utcMinutes)
}

/**
 * Format timezone offset for display (e.g., "UTC+8", "UTC-5")
 */
export function formatTimezoneOffset(offset: number): string {
  if (offset === 0) return "UTC"
  const sign = offset >= 0 ? "+" : ""
  return `UTC${sign}${offset}`
}

/**
 * Get current time in HH:MM format (UTC)
 */
export function getCurrentTimeUTC(): string {
  const now = new Date()
  return `${now.getUTCHours().toString().padStart(2, "0")}:${now.getUTCMinutes().toString().padStart(2, "0")}`
}

/**
 * Get current date in YYYY-MM-DD format (UTC)
 */
export function getCurrentDateUTC(): string {
  const now = new Date()
  return now.toISOString().split("T")[0]
}

/**
 * Parse time input that might be in various formats
 * Accepts: "1430", "14:30", "2:30"
 * Returns: "14:30" (standardized HH:MM)
 */
export function parseTimeInput(input: string): string {
  if (!input) return ""

  // Remove all non-digit characters except colon
  const cleaned = input.replace(/[^\d:]/g, "")

  // If it has a colon, split and format
  if (cleaned.includes(":")) {
    const [h, m] = cleaned.split(":")
    const hours = Number.parseInt(h, 10)
    const minutes = Number.parseInt(m, 10)
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return ""
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return ""
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
  }

  // No colon - assume HHMM format
  if (cleaned.length === 4) {
    const hours = Number.parseInt(cleaned.slice(0, 2), 10)
    const minutes = Number.parseInt(cleaned.slice(2, 4), 10)
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return ""
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return ""
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
  }

  // HMM format (e.g., "230" for 2:30)
  if (cleaned.length === 3) {
    const hours = Number.parseInt(cleaned.slice(0, 1), 10)
    const minutes = Number.parseInt(cleaned.slice(1, 3), 10)
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return ""
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return ""
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
  }

  return ""
}

/**
 * Date components returned from parseDateString
 */
export interface DateComponents {
  year: number
  month: number // 1-12
  day: number
}

/**
 * Time components returned from parseTimeString
 */
export interface TimeComponents {
  hours: number
  minutes: number
}

/**
 * Parse YYYY-MM-DD date string to components
 * Returns null if invalid
 */
export function parseDateString(dateStr: string): DateComponents | null {
  if (!dateStr || typeof dateStr !== "string") return null

  const parts = dateStr.split("-")
  if (parts.length !== 3) return null

  const year = Number.parseInt(parts[0], 10)
  const month = Number.parseInt(parts[1], 10)
  const day = Number.parseInt(parts[2], 10)

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  return { year, month, day }
}

/**
 * Parse HH:MM time string to components
 * Returns null if invalid
 */
export function parseTimeString(timeStr: string): TimeComponents | null {
  if (!timeStr || typeof timeStr !== "string") return null

  const parts = timeStr.split(":")
  if (parts.length !== 2) return null

  const hours = Number.parseInt(parts[0], 10)
  const minutes = Number.parseInt(parts[1], 10)

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  if (hours < 0 || hours > 23) return null
  if (minutes < 0 || minutes > 59) return null

  return { hours, minutes }
}

/**
 * Create a UTC Date from date and time strings
 * @param dateStr - Date in YYYY-MM-DD format
 * @param timeStr - Time in HH:MM format
 * @returns Date object in UTC, or null if invalid
 */
export function createUTCDate(dateStr: string, timeStr: string): Date | null {
  const dateParts = parseDateString(dateStr)
  const timeParts = parseTimeString(timeStr)

  if (!dateParts || !timeParts) return null

  return new Date(
    Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hours,
      timeParts.minutes,
      0,
      0
    )
  )
}

/**
 * Parse date and time strings to UTC Date, handling overnight flights
 * If the time appears to wrap to the next day (for overnight detection),
 * an optional flag can be provided to add a day
 * @param dateStr - Date in YYYY-MM-DD format
 * @param timeStr - Time in HH:MM format
 * @param addDay - Whether to add a day (for overnight flight end times)
 * @returns Date object in UTC, or null if invalid
 */
export function parseTimeToUTC(
  dateStr: string,
  timeStr: string,
  addDay = false
): Date | null {
  const date = createUTCDate(dateStr, timeStr)
  if (!date) return null

  if (addDay) {
    date.setUTCDate(date.getUTCDate() + 1)
  }

  return date
}

/**
 * Detect if a flight is overnight (end time is before start time)
 * and return the appropriate day offset for the end time
 */
export function detectOvernightOffset(
  startTime: string,
  endTime: string
): number {
  const startParts = parseTimeString(startTime)
  const endParts = parseTimeString(endTime)

  if (!startParts || !endParts) return 0

  const startMinutes = startParts.hours * 60 + startParts.minutes
  const endMinutes = endParts.hours * 60 + endParts.minutes

  return endMinutes < startMinutes ? 1 : 0
}

/**
 * Apply a day offset to a date string
 * @param dateStr - Date in YYYY-MM-DD format
 * @param dayOffset - Number of days to add (can be negative)
 * @returns New date string in YYYY-MM-DD format, or empty string if invalid
 */
export function applyDayOffset(dateStr: string, dayOffset: number): string {
  const dateParts = parseDateString(dateStr)
  if (!dateParts) return ""

  const date = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day))
  date.setUTCDate(date.getUTCDate() + dayOffset)

  const year = date.getUTCFullYear()
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0")
  const day = date.getUTCDate().toString().padStart(2, "0")

  return `${year}-${month}-${day}`
}
