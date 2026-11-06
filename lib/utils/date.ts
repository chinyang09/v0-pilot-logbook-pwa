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

/**
 * Format a Date as a "YYYY-MM-DD" key using its LOCAL calendar fields.
 *
 * Never use `date.toISOString().split("T")[0]` for this — that converts to UTC
 * and rolls the date back a day for any positive-offset timezone (e.g. a locally
 * constructed midnight in SGT/UTC+8 becomes the previous day), which silently
 * files calendar entries under the wrong cell.
 */
export function formatLocalYMD(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * THE way the app writes a day: `Fri, 27 Nov 26` — weekday, day, month, two-
 * digit year (the owner's choice, Nov 2026). Every date a pilot reads goes
 * through here, so the flight form, the roster, the FDP page and the dashboard
 * cannot drift apart again (they did: half the app read "Nov 27", half
 * "27 Nov"). Where a context makes a part redundant or there is no room for
 * it — a chart axis, a range inside one period — a part is DROPPED, never
 * reordered: `27 Nov`, `Fri, 27 Nov`, `27 Nov 26`.
 *
 * Built from the parts by hand rather than through an Intl locale: `en-GB`
 * and `en-US` disagree on order and comma, and Node's ICU and a browser's can
 * disagree with each other, which is a hydration mismatch.
 */
export interface DayFormat {
  /** "Fri, " — default true */
  weekday?: boolean
  /** " 26" — default true */
  year?: boolean
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Year, month (0–11) and day of a CALENDAR date, written the app's way. */
export function formatDayParts(year: number, month0: number, day: number, opts: DayFormat = {}): string {
  const { weekday = true, year: withYear = true } = opts
  const body = `${day} ${MON[month0]}${withYear ? ` ${String(((year % 100) + 100) % 100).padStart(2, "0")}` : ""}`
  if (!weekday) return body
  return `${WD[new Date(Date.UTC(year, month0, day)).getUTCDay()]}, ${body}`
}

/** A stored "YYYY-MM-DD" date — a calendar date, no zone. */
export function formatDay(ymd: string, opts?: DayFormat): string {
  if (!ymd) return ""
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(5, 7))
  const d = Number(ymd.slice(8, 10))
  if (!y || !m || !d) return ymd
  return formatDayParts(y, m - 1, d, opts)
}

/**
 * The day an INSTANT falls on in `timeZone` ("UTC", an IANA zone), or on the
 * device's own calendar when omitted.
 */
export function formatDayAt(at: number | Date, timeZone?: string, opts?: DayFormat): string {
  const date = typeof at === "number" ? new Date(at) : at
  if (!Number.isFinite(date.getTime())) return ""
  if (!timeZone) return formatDayParts(date.getFullYear(), date.getMonth(), date.getDate(), opts)
  if (timeZone === "UTC") return formatDayParts(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), opts)
  let fmt = zoneDay.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
    zoneDay.set(timeZone, fmt)
  }
  let y = 0, m = 0, d = 0
  for (const p of fmt.formatToParts(date)) {
    if (p.type === "year") y = Number(p.value)
    else if (p.type === "month") m = Number(p.value)
    else if (p.type === "day") d = Number(p.value)
  }
  return formatDayParts(y, m - 1, d, opts)
}
const zoneDay = new Map<string, Intl.DateTimeFormat>()

const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** A moment something HAPPENED on this device — signed, deleted, noted:
 *  `Fri, 27 Nov 26 14:05`, in the device's own clock. */
export function formatStamp(at: number | string | Date): string {
  const date = at instanceof Date ? at : new Date(at)
  if (!Number.isFinite(date.getTime())) return ""
  return `${formatDayAt(date)} ${CLOCK.format(date)}`
}

/** "16 Apr" */
export function formatYMDShort(ymd: string): string {
  return formatDay(ymd, { weekday: false, year: false })
}

/** "Thu, 16 Apr 26" */
export function formatYMDMedium(ymd: string): string {
  return formatDay(ymd)
}
