/**
 * The currency tile's DOT CALENDAR (the owner, Nov 2026, after a "days of the
 * year" widget): one dot a day, seven to a column (a week, Monday at the top),
 * running AHEAD from today — and each currency's expiry is one dot lit on it.
 *
 * How far it looks depends on the tile's width: a third of the row looks 90
 * days ahead (13 weeks — 90-day recency is the one most likely to bind), half
 * or two thirds six months, the whole row a year. The ends are CALENDAR dates,
 * so a year ahead is 365 or 366 days as the calendar has it (a 29 February in
 * range is one more dot).
 *
 * Pure, on "YYYY-MM-DD" day keys, so it is tested without the page.
 */

const DAY = 86_400_000

const toUtc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}
const ymdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Whole days from `a` to `b` (both day keys). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY)
}

/** The day `n` days after `ymd`. */
export function addDays(ymd: string, n: number): string {
  return ymdOf(toUtc(ymd) + n * DAY)
}

/** The same calendar date `months` later (31 Jan + 1 month is 3 Mar, as Date has it; 29 Feb + 12 is 1 Mar). */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return ymdOf(Date.UTC(y, m - 1 + months, d))
}

/** The look-ahead a tile of `cols` (of three) shows: 90 days, six months, a year. */
export type LookAhead = "90d" | "6m" | "1y"
export const lookAheadFor = (cols: number): LookAhead => (cols >= 3 ? "1y" : cols >= 2 ? "6m" : "90d")
export const LOOK_AHEAD_LABEL: Record<LookAhead, string> = { "90d": "90 days", "6m": "6 months", "1y": "1 year" }

/** How many days, today included, a look-ahead covers from `today`. */
export function lookAheadDays(today: string, ahead: LookAhead): number {
  if (ahead === "90d") return 91 // 13 whole weeks: today and the 90 days after it
  return daysBetween(today, addMonths(today, ahead === "6m" ? 6 : 12))
}

export interface DotLayout {
  today: string
  /** Days drawn, today first. */
  days: number
  /** Today's row: Monday 0 … Sunday 6. The first column's earlier rows are empty. */
  offset: number
  /** Columns (weeks). */
  weeks: number
  /** The first of each month in range: its column, and the month's short name. */
  months: Array<{ week: number; label: string }>
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function dotLayout(today: string, ahead: LookAhead): DotLayout {
  const days = lookAheadDays(today, ahead)
  const offset = (new Date(toUtc(today)).getUTCDay() + 6) % 7
  const weeks = Math.ceil((offset + days) / 7)
  const months: DotLayout["months"] = []
  for (let i = 0; i < days; i++) {
    const ymd = addDays(today, i)
    if (ymd.endsWith("-01")) months.push({ week: Math.floor((offset + i) / 7), label: MONTH[Number(ymd.slice(5, 7)) - 1] })
  }
  return { today, days, offset, weeks, months }
}

/** Where a day falls: its column and row, or null outside the range. A day already past is today. */
export function dotAt(layout: DotLayout, ymd: string): { week: number; row: number; index: number } | null {
  const index = Math.max(0, daysBetween(layout.today, ymd))
  if (index >= layout.days) return null
  const n = layout.offset + index
  return { week: Math.floor(n / 7), row: n % 7, index }
}

/** The device's calendar day at `ms`, as a key. */
export function localDayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
