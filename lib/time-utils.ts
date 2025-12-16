/**
 * Time utility functions for HH:MM format storage
 * All times are stored as "HH:MM" strings for accurate post-processing
 */

/**
 * Convert decimal hours to HH:MM string
 */
export function decimalToHHMM(decimal: number): string {
  if (decimal <= 0) return "00:00"
  const hours = Math.floor(decimal)
  const minutes = Math.round((decimal - hours) * 60)
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
}

/**
 * Convert HH:MM string to decimal hours
 */
export function hhmmToDecimal(hhmm: string): number {
  if (!hhmm || hhmm === "00:00") return 0
  const [hours, minutes] = hhmm.split(":").map(Number)
  return hours + minutes / 60
}

/**
 * Add two HH:MM times together
 */
export function addHHMM(time1: string, time2: string): string {
  const decimal1 = hhmmToDecimal(time1)
  const decimal2 = hhmmToDecimal(time2)
  return decimalToHHMM(decimal1 + decimal2)
}

/**
 * Calculate difference between two HH:MM times (for same day)
 * Returns HH:MM format
 */
export function calculateDuration(startTime: string, endTime: string, date: string): string {
  const parseTime = (time: string): Date => {
    const [hours, minutes] = time.split(":").map(Number)
    const dt = new Date(date)
    dt.setUTCHours(hours, minutes, 0, 0)
    return dt
  }

  const start = parseTime(startTime)
  const end = parseTime(endTime)

  // Handle overnight
  if (end < start) {
    end.setUTCDate(end.getUTCDate() + 1)
  }

  const diffMinutes = (end.getTime() - start.getTime()) / (1000 * 60)
  const hours = Math.floor(diffMinutes / 60)
  const minutes = Math.round(diffMinutes % 60)

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
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
 * Sum an array of HH:MM strings
 */
export function sumHHMM(times: string[]): string {
  const totalDecimal = times.reduce((sum, time) => sum + hhmmToDecimal(time || "00:00"), 0)
  return decimalToHHMM(totalDecimal)
}
