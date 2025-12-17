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
 * Returns HH:MM format
 */
export function calculateDuration(
  startTime: string | undefined | null,
  endTime: string | undefined | null,
  date?: string,
): string {
  if (!startTime || !endTime) return "00:00"

  const parseTimeToMinutes = (time: string): number => {
    const parts = time.split(":")
    if (parts.length !== 2) return 0
    const hours = Number.parseInt(parts[0], 10)
    const minutes = Number.parseInt(parts[1], 10)
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0
    return hours * 60 + minutes
  }

  const startMins = parseTimeToMinutes(startTime)
  let endMins = parseTimeToMinutes(endTime)

  // Handle overnight (if end is before start, add 24 hours)
  if (endMins < startMins) {
    endMins += 24 * 60
  }

  const diffMinutes = endMins - startMins
  return minutesToHHMM(diffMinutes)
}

/**
 * Format HH:MM for display (e.g., "2:30" or "12:45")
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
 */
export function formatTimeShort(hhmm: string | undefined | null): string {
  if (!hhmm || typeof hhmm !== "string") return "0:00"
  const parts = hhmm.split(":")
  if (parts.length !== 2) return "0:00"
  const hours = Number.parseInt(parts[0], 10)
  const minutes = parts[1]
  if (Number.isNaN(hours)) return "0:00"
  return `${hours}:${minutes}`
}

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
 * @param utcTime - Time in HH:MM format (UTC)
 * @param timezoneOffset - Offset from UTC in hours (e.g., 8 for UTC+8, -5 for UTC-5)
 * @returns Time in HH:MM format (local)
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
 * @param localTime - Time in HH:MM format (local)
 * @param timezoneOffset - Offset from UTC in hours (e.g., 8 for UTC+8, -5 for UTC-5)
 * @returns Time in HH:MM format (UTC)
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
