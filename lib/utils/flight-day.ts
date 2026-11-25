/**
 * Which DAY a flight's times fall on.
 *
 * A flight is keyed on the UTC date of its OUT — the actual OUT once there is
 * one (the importers write it so: `anchor = actOut || schedOut`), the
 * scheduled OUT before. So a red-eye scheduled 23:55 and off blocks at 00:28
 * is dated the NEXT day, and its schedule is the evening before that date.
 * Read on the flight's own date, the schedule was 23:55 of the wrong day: the
 * FDP read its report as 01:35 the next morning, and the Flight Deck a delay
 * of −23:27 (the owner's red-eye, Nov 2026).
 *
 * The rule both ways: an actual OUT lies between two hours BEFORE its
 * scheduled OUT and twenty-two hours after it — a departure is never much
 * early, a delay can run long.
 */

const DAY_MIN = 1440
/** How early a departure can be before it reads as the day before. */
export const EARLY_OUT_MIN = 120

const isClock = (t?: string | null): t is string => !!t && /^\d{1,2}:\d{2}$/.test(t)
const minutesOf = (t: string) => {
  const i = t.indexOf(":")
  return Number(t.slice(0, i)) * 60 + Number(t.slice(i + 1))
}

type Timed = { outTime?: string | null; scheduledOut?: string | null; scheduledIn?: string | null }

/**
 * The scheduled OUT in minutes from the flight DATE's midnight: read on the
 * date when nothing has flown, else moved by whole days so the actual OUT
 * (on the date) lies within [scheduled − 2h, scheduled + 22h). −5 for a 23:55
 * schedule of a flight off blocks at 00:28. Null without a schedule.
 */
export function scheduledOutMinutes(f: Timed): number | null {
  if (!isClock(f.scheduledOut)) return null
  let m = minutesOf(f.scheduledOut)
  if (!isClock(f.outTime)) return m
  const a = minutesOf(f.outTime)
  while (a < m - EARLY_OUT_MIN) m -= DAY_MIN
  while (a >= m - EARLY_OUT_MIN + DAY_MIN) m += DAY_MIN
  return m
}

/** The scheduled IN in minutes from the date's midnight: the first at or after the scheduled OUT. */
export function scheduledInMinutes(f: Timed): number | null {
  if (!isClock(f.scheduledIn)) return null
  let m = minutesOf(f.scheduledIn)
  const out = scheduledOutMinutes(f)
  if (out === null) return m
  while (m < out) m += DAY_MIN
  while (m - DAY_MIN >= out) m -= DAY_MIN
  return m
}

const midnightMs = (date: string) => {
  const ms = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

/** The scheduled OUT as an instant (`scheduledOutMinutes`). */
export function scheduledOutMs(f: Timed & { date: string }): number | null {
  const m = scheduledOutMinutes(f)
  const d = midnightMs(f.date)
  return m === null || d === null ? null : d + m * 60_000
}

/** The scheduled IN as an instant, after the scheduled OUT. */
export function scheduledInMs(f: Timed & { date: string }): number | null {
  const m = scheduledInMinutes(f)
  const d = midnightMs(f.date)
  return m === null || d === null ? null : d + m * 60_000
}

const shiftDate = (date: string, days: number) => {
  const d = midnightMs(date)
  return d === null ? date : new Date(d + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * The date a flight is keyed on once its OUT changes from `before` to
 * `after` — what an import writes, for an OUT typed by hand. From no OUT the
 * row is dated by its schedule, so the new OUT is placed against the
 * schedule; from an OUT, against that OUT (the nearest day). Clearing the OUT
 * dates it by its schedule again. The date unchanged where nothing says
 * otherwise.
 */
export function dateForOut(
  row: { date: string; outTime?: string | null; scheduledOut?: string | null },
  out: string | null | undefined,
): string {
  if (!row.date) return row.date
  const had = isClock(row.outTime)
  if (!isClock(out)) {
    // Back to the schedule's own day.
    if (!had) return row.date
    const s = scheduledOutMinutes(row)
    return s === null ? row.date : shiftDate(row.date, Math.floor(s / DAY_MIN))
  }
  let ref: number
  let earliest: number
  if (had) {
    ref = minutesOf(row.outTime!)
    earliest = ref - DAY_MIN / 2
  } else if (isClock(row.scheduledOut)) {
    ref = minutesOf(row.scheduledOut)
    earliest = ref - EARLY_OUT_MIN
  } else return row.date
  let a = minutesOf(out)
  let days = 0
  while (a < earliest) {
    a += DAY_MIN
    days++
  }
  while (a >= earliest + DAY_MIN) {
    a -= DAY_MIN
    days--
  }
  return shiftDate(row.date, days)
}
