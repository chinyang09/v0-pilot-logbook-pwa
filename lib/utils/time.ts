/**
 * Time utility functions for HH:MM format storage
 * All times are stored as "HH:MM" strings for accurate post-processing
 */

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
  const total = Math.round(totalMinutes)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
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
 * Format HH:MM for display
 * @param hhmm - Time in HH:MM format
 * @param format - Display format: "24h" (2:30), "24h-padded" (02:30), "12h" (2:30 PM)
 */
/**
 * Format a CLOCK time (an instant: out/off/on/in, sunrise, a picker value)
 * for display, honouring the user's separator preference.
 *
 * Deliberately separate from `formatHHMMDisplay`, which formats DURATIONS —
 * those always keep their colon, because "400" cannot be read as four hours.
 * Anything that shows a point in time should come through here so one setting
 * governs the whole app.
 */
export function formatClockDisplay(
  hhmm: string | undefined | null,
  separator: "colon" | "none" = "colon",
  placeholder = ""
): string {
  if (!hhmm || typeof hhmm !== "string") return placeholder
  const trimmed = hhmm.trim().slice(0, 5)
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return trimmed || placeholder
  const [h, m] = trimmed.split(":")
  const hours = h.padStart(2, "0")
  return separator === "none" ? `${hours}${m}` : `${hours}:${m}`
}

export function formatHHMMDisplay(
  hhmm: string | undefined | null,
  format: "24h" | "24h-padded" | "12h" = "24h"
): string {
  if (!hhmm || typeof hhmm !== "string") return "0:00"
  const parts = hhmm.split(":")
  if (parts.length !== 2) return "0:00"
  const hours = Number.parseInt(parts[0], 10)
  const minutes = parts[1]
  if (Number.isNaN(hours)) return "0:00"

  if (format === "24h-padded") {
    return `${hours.toString().padStart(2, "0")}:${minutes}`
  }

  if (format === "12h") {
    const period = hours >= 12 ? "PM" : "AM"
    const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    return `${h12}:${minutes} ${period}`
  }

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
