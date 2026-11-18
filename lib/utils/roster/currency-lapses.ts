/**
 * The pilot's documents on the FDP page — a medical, a licence, an OPC — as
 * moments on the same time axis as the duties (the owner, Nov 2026: "FDP to
 * reflect currencies expiry as well").
 *
 * A currency's `expiryDate` is its LAST VALID DAY (`getCurrencyStatus`: it is
 * "expired" from the day after). The day is read at the home base (Singapore,
 * the clock the FDP page reads local nights in), so it lapses at 00:00 SGT the
 * day after. What a pilot needs from that, on a page about duties:
 *
 * | | finding |
 * |---|---|
 * | a duty that FLIES on or after the lapse | a violation, on that duty — the first one only |
 * | otherwise, a lapse within its own warning window, ahead | a caution, on the lapse |
 *
 * Only a duty with an operated or positioning sector counts: a simulator
 * session or a ground duty may well be the renewal itself, and a standby only
 * becomes flying once called out.
 */

import type { Currency } from "@/types/entities/roster.types"
import type { DutyBlock } from "./duty-timeline"

const DAY = 86_400_000
const SGT_MS = 8 * 3_600_000

export interface CurrencyLapse {
  id: string
  /** "MEDICAL", "OPC 320" — what the pilot calls it. */
  name: string
  /** The last valid day, "YYYY-MM-DD". */
  expiryDate: string
  /** 00:00 SGT the day after — the first instant it is not valid. */
  lapseMs: number
}

export interface CurrencyFinding {
  key: string
  atMs: number
  severity: "violation" | "caution"
  text: string
  source: string
}

/** The first instant a currency is not valid, or null for a date it cannot read. */
export function lapseOf(expiryDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiryDate || "")
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1) - SGT_MS
}

/** Every live currency's lapse, soonest first. */
export function currencyLapses(currencies: readonly Currency[]): CurrencyLapse[] {
  const out: CurrencyLapse[] = []
  for (const c of currencies) {
    if (c.deletedAt != null) continue
    const lapseMs = lapseOf(c.expiryDate)
    if (lapseMs === null) continue
    out.push({ id: c.id, name: (c.description || c.code || "Currency").trim(), expiryDate: c.expiryDate, lapseMs })
  }
  return out.sort((a, b) => a.lapseMs - b.lapseMs)
}

const flies = (b: DutyBlock) => b.kind === "flight" && b.sectors.some((s) => !s.simulator)

/**
 * What the documents mean for the duties drawn: a duty flown on an expired
 * one, or one about to expire. `nowMs` bounds both — a duty already flown on
 * a document that has since been renewed is not news.
 */
export function currencyFindings(
  currencies: readonly Currency[],
  blocks: readonly DutyBlock[],
  nowMs: number,
): CurrencyFinding[] {
  const ahead = blocks.filter((b) => flies(b) && b.endMs >= nowMs).sort((a, b) => a.startMs - b.startMs)
  const out: CurrencyFinding[] = []
  for (const c of currencies) {
    if (c.deletedAt != null) continue
    const lapseMs = lapseOf(c.expiryDate)
    if (lapseMs === null) continue
    const name = (c.description || c.code || "Currency").trim()
    const hit = ahead.find((b) => b.startMs >= lapseMs)
    if (hit) {
      const what = hit.sectors.find((s) => !s.simulator)?.flightNumber || hit.route || "Duty"
      out.push({ key: `cur-${c.id}`, atMs: hit.startMs, severity: "violation", text: `${what} after ${name} expires`, source: name })
    } else if (lapseMs >= nowMs && lapseMs - nowMs <= Math.max(1, c.warningDays || 30) * DAY) {
      out.push({ key: `cur-${c.id}`, atMs: lapseMs, severity: "caution", text: `${name} expires`, source: name })
    }
  }
  return out
}
