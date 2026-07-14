/**
 * Canonical YYYY-MM-DD calendar-date helpers.
 *
 * Every date stored on flights/schedule entries is a plain "YYYY-MM-DD"
 * calendar date. Parse it as a LOCAL date via `parseYMDLocal` (never
 * `new Date("YYYY-MM-DD")`, which parses as UTC midnight and shifts a day in
 * western timezones) and format it via the helpers below — don't re-implement
 * per-file copies (the audit found 7+ drifting variants, some UTC, some local).
 */

/** Parse "YYYY-MM-DD" (2- or 4-digit year) as a local calendar date. */
export function parseYMDLocal(dateStr: string): Date {
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

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return new Date()
  }

  return new Date(year, month - 1, day)
}

/** Format "YYYY-MM-DD" with arbitrary Intl options (local, no TZ shift). */
export function formatYMD(
  ymd: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string
): string {
  if (!ymd) return ""
  return parseYMDLocal(ymd).toLocaleDateString(locale, options)
}

/** "Apr 16" */
export function formatYMDShort(ymd: string): string {
  return formatYMD(ymd, { month: "short", day: "numeric" })
}

/** "Apr 16, 2026" */
export function formatYMDMedium(ymd: string): string {
  return formatYMD(ymd, { month: "short", day: "numeric", year: "numeric" }, "en-US")
}

/** Format a minute count as "Xh Ym" (e.g. 95 → "1h 35m", 60 → "1h", 45 → "45m"). */
export function formatMinutesHM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
