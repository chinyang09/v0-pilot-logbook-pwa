/**
 * The dashboard's CURRENCY card, as a summary of the Currencies page (the
 * owner, Nov 2026: "a summary of each section… so the user doesn't have to go
 * to the other tab").
 *
 * The page lists every document in two groups — what needs attention, then
 * what is current, each soonest first — by its NAME, the days left and the
 * expiry date. The card reads the same: the same names, the same figure
 * (`daysFigure`), the same order. What the card adds is the one question the
 * page cannot answer: does anything run out BEFORE the duty the dashboard is
 * about? A document valid today that lapses before that duty reports is
 * flagged with it, because it is the duty it stops.
 *
 * Pure, so it is tested without the page.
 */

import type { CurrencyWithStatus } from "@/types/entities/roster.types"
import type { RequirementState } from "./legality"
import { lapseOf } from "@/lib/utils/roster/currency-lapses"

/**
 * The figure a pilot reads: days left, or that it has gone. Past a year it is
 * years — "2888d" is a number to work out, "7.9y" is an answer. The Currencies
 * page's rows and the dashboard's card both write it this way.
 */
export function daysFigure(days: number): string {
  if (days < 0) return "Expired"
  if (days === 0) return "Today"
  if (days >= 365) return `${(days / 365).toFixed(1)}y`
  return `${days}d`
}

export interface CurrencyLine {
  id: string
  /** What the Currencies page calls it: its description, else its code. */
  name: string
  state: RequirementState
  /** "45d", "1.2y", "Today", "Expired". */
  figure: string
  /** The last valid day, YYYY-MM-DD. */
  expiryDate: string
  daysRemaining: number
  /** Valid now, gone by the time the chosen duty reports. */
  lapsesBeforeDuty: boolean
}

export interface CurrencySummary {
  /** Expired, inside its warning window, or lapsing before the duty — soonest first. */
  attention: CurrencyLine[]
  /** Everything else, soonest first. */
  current: CurrencyLine[]
}

const stateOf = (c: CurrencyWithStatus): RequirementState =>
  c.status === "expired" ? "fail" : c.status === "critical" || c.status === "warning" ? "caution" : "ok"

const DAY_MS = 86_400_000
const SGT_MS = 8 * 3_600_000

/** The Singapore calendar day of an instant, as days since the epoch — the clock a currency lapses on. */
const sgtDay = (ms: number) => Math.floor((ms + SGT_MS) / DAY_MS)

/** Days from the Singapore day of `atMs` to a document's last valid day (negative once it has gone). */
export function daysLeftAt(expiryDate: string, atMs: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiryDate || "")
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS - sgtDay(atMs)
}

/**
 * The documents, grouped as the Currencies page groups them. `dutyAtMs` is the
 * report of the duty the dashboard is about (null when none is rostered).
 *
 * `asOfMs` FORECASTS them (the owner, Nov 2026: every other tile forecasts a
 * later duty, the currency did not): each document's days left and state as
 * they will stand on that day — inside its warning window then is a caution
 * then — rather than today. Null judges them today, as the page does.
 */
export function currencySummary(
  currencies: readonly CurrencyWithStatus[],
  dutyAtMs: number | null,
  asOfMs: number | null = null,
): CurrencySummary {
  const lines = [...currencies]
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.code.localeCompare(b.code))
    .map((c): CurrencyLine => {
      const lapse = lapseOf(c.expiryDate)
      const now = stateOf(c)
      const lapsesBeforeDuty = now !== "fail" && dutyAtMs !== null && lapse !== null && lapse <= dutyAtMs
      const ahead = asOfMs === null ? null : daysLeftAt(c.expiryDate, asOfMs)
      const days = ahead ?? c.daysRemaining
      // Forecast, a document that has gone by then is still renewable today: a
      // caution ("before duty"), not the red of one already expired.
      const state: RequirementState =
        ahead === null
          ? lapsesBeforeDuty && now === "ok" ? "caution" : now
          : now === "fail"
            ? "fail"
            : lapsesBeforeDuty || ahead <= c.warningDays
              ? "caution"
              : "ok"
      return {
        id: c.id,
        name: (c.description || "").trim() || c.code,
        state,
        figure: daysFigure(days),
        expiryDate: c.expiryDate,
        daysRemaining: days,
        lapsesBeforeDuty,
      }
    })
  return {
    attention: lines.filter((l) => l.state !== "ok"),
    current: lines.filter((l) => l.state === "ok"),
  }
}
