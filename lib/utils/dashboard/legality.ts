/**
 * "Am I legal to fly?" — as a list of requirements, not a verdict.
 *
 * A banner reading LEGAL is worth very little to a pilot. It cannot be checked,
 * it cannot be planned against, and on the day it flips to NOT LEGAL it does not
 * say which of half a dozen things went. So this module does not compute a
 * verdict and explain it afterwards: it computes the REQUIREMENTS, each with its
 * own state, and the verdict is nothing more than the worst one of them.
 *
 * **Two groups, because they are two different kinds of thing** and mixing them
 * is what made the first version unreadable at a glance:
 *
 * | Group | Question | Unit | Source |
 * |---|---|---|---|
 * | `currency` | am I qualified and recent | DAYS | the logbook (recency) + the currencies table |
 * | `limits` | how much have I used up | HOURS | CAAS Reg 12 / 107, `calculateCapacity` |
 *
 * Rest is deliberately NOT here. It is a property of the duty just flown, not a
 * standing qualification, so it belongs to the duty panel — see `duty-status.ts`
 * — and printing it in a currency grid put a countdown among a column of expiry
 * dates.
 *
 * Every requirement reduces to the same handful of fields so one cell shape
 * renders all of them and a new requirement is a new entry, not a new layout.
 *
 * Pure: no React, no Dexie, no clock of its own beyond the `now` handed in.
 */

import type { CurrencyWithStatus } from "@/types/entities/roster.types"
import type { NinetyDayCurrency } from "@/lib/utils/dashboard-aggregate"

export type RequirementState = "ok" | "caution" | "fail" | "unknown"

/**
 * `currency` is measured in days and EXPIRES; `limits` are measured in hours
 * and REFILL. That difference is why they are never sorted into one list.
 */
export type RequirementGroup = "currency" | "limits"

export interface Requirement {
  id: string
  group: RequirementGroup
  /** Two words at most — the cell is read in a grid, not a sentence. */
  label: string
  state: RequirementState
  /** The readout: "8d", "68 / 100h", "Expired". */
  value: string
  /** How full the requirement is, 0..1. `undefined` when nothing can be
   *  meaningfully metered (an unknown, or a fold row). */
  progress?: number
  /**
   * Days until this requirement stops being met. Set only for `currency` —
   * a rolling hours limit does not expire, it refills, which is exactly why it
   * must never win the "what runs out first" comparison.
   */
  daysUntil?: number
  /** The lines an expanded cell reveals. Never needed to read the cell. */
  detail?: string[]
  /** Where a deep link goes, for the cases a tap-to-expand cannot answer. */
  href: string
  /** Set only when not met or close to it; higher is more pressing. */
  urgency?: number
  /**
   * What to DO about it, when this requirement is the binding one — "2 landings
   * required", not "landings 1 / 3". Phrased here because this is where the
   * shortfall is actually in hand.
   */
  action?: string
}

export interface LegalityModel {
  /** The worst state across every requirement. */
  verdict: RequirementState
  requirements: Requirement[]
  /**
   * The one thing closest to stopping the pilot flying.
   *
   * When something is flagged this is the most pressing flagged requirement.
   * When nothing is, it is whichever CURRENCY expires soonest — not the fullest
   * rolling limit, which was the first version's answer and was simply wrong:
   * 604 of 1000 flight hours over twelve months is 41% "full" and roughly six
   * months of headroom, so calling it the tightest constraint on an otherwise
   * clear pilot named the least urgent thing on the page.
   */
  binding: Requirement | null
  counts: { ok: number; caution: number; fail: number; total: number }
}

const STATE_RANK: Record<RequirementState, number> = {
  ok: 0,
  unknown: 1,
  caution: 2,
  fail: 3,
}

function worst(states: RequirementState[]): RequirementState {
  return states.reduce<RequirementState>(
    (acc, s) => (STATE_RANK[s] > STATE_RANK[acc] ? s : acc),
    "ok",
  )
}

/** Fraction of a rolling limit at which the row starts warning. */
const LIMIT_CAUTION = 0.8

/** A currency is worth flagging before it lapses, not on the day. */
const RECENCY_CAUTION_DAYS = 14

/** Takeoffs (and landings) required inside the 90-day window. */
const RECENCY_REQUIRED = 3

function hours(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  // A rolling total is read against a two- or three-figure limit, so one
  // decimal is precision nobody uses and it costs the cell its width.
  return n >= 10 ? Math.round(n).toString() : n.toFixed(1)
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`)
  const b = Date.parse(`${toIso}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${d.getUTCDate().toString().padStart(2, "0")}`
}

/** The four rolling limits. */
export interface CapacityInput {
  duty14Days: { used: number; limit: number; remaining: number }
  duty28Days: { used: number; limit: number; remaining: number }
  flight28Days: { used: number; limit: number; remaining: number }
  flight365Days: { used: number; limit: number; remaining: number }
}

export interface LegalityInput {
  recency: NinetyDayCurrency
  capacity: CapacityInput
  /** Rolling limits a future schedule is projected to breach, by limit name. */
  forecastBreaches?: string[]
  currencies: CurrencyWithStatus[]
  /** How many documents get their own cell before the rest are folded up. */
  documentRows?: number
  now?: Date
}

/**
 * How many document cells are shown individually.
 *
 * A line pilot carries a dozen or more currencies, and a grid of twelve cells
 * that are all green is not information — it is why the panel would stop being
 * readable at a glance. The nearest few expiries are the ones that can change
 * state before the next look; the rest fold into one cell stating how many are
 * clear, which the reader can expand.
 */
const DEFAULT_DOCUMENT_ROWS = 3

export function buildLegalityModel({
  recency,
  capacity,
  forecastBreaches = [],
  currencies,
  documentRows = DEFAULT_DOCUMENT_ROWS,
  now = new Date(),
}: LegalityInput): LegalityModel {
  const requirements: Requirement[] = []
  const todayIso = toIsoDate(now)

  // ── Recency: ONE requirement, not two ───────────────────────────────────
  //
  // Takeoffs and landings were separate cells and they read as two unrelated
  // rows that happened to say the same thing — and, sorted by urgency, they did
  // not even sit next to each other. A pilot checks "am I recent" as one
  // question. The cell answers it with the binding half; expanding shows both.
  const toShort = Math.max(0, RECENCY_REQUIRED - recency.takeoffs)
  const ldgShort = Math.max(0, RECENCY_REQUIRED - recency.landings)
  const recencyMet = toShort === 0 && ldgShort === 0
  const daysToLapse = recency.lapseIso ? daysBetween(todayIso, recency.lapseIso) : undefined
  const lapsingSoon =
    recencyMet && daysToLapse !== undefined && daysToLapse <= RECENCY_CAUTION_DAYS

  requirements.push({
    id: "recency",
    group: "currency",
    label: "90-day recency",
    state: !recencyMet ? "fail" : lapsingSoon ? "caution" : "ok",
    value: !recencyMet
      ? `${Math.min(recency.takeoffs, recency.landings)} / 3`
      : daysToLapse !== undefined
        ? `${daysToLapse}d`
        : "Current",
    progress: Math.min(1, Math.min(recency.takeoffs, recency.landings) / RECENCY_REQUIRED),
    daysUntil: recencyMet ? daysToLapse : 0,
    detail: [
      `Takeoffs ${recency.takeoffs} / ${RECENCY_REQUIRED}`,
      `Landings ${recency.landings} / ${RECENCY_REQUIRED}`,
      recency.lapseIso ? `Lapses ${recency.lapseIso}` : "Not currently met",
    ],
    href: "/logbook",
    urgency: !recencyMet ? 900 : lapsingSoon ? 400 - Math.min(399, daysToLapse ?? 0) : undefined,
    action: !recencyMet
      ? shortfallAction(toShort, ldgShort)
      : lapsingSoon
        ? `T/O + landing in ${daysToLapse}d`
        : undefined,
  })

  // ── Documents ───────────────────────────────────────────────────────────
  // Nearest expiry first. An EXPIRED document is a hard stop; one inside its own
  // critical/warning window is still valid, so it cautions rather than fails —
  // the distinction is the whole point of the two thresholds a currency carries.
  const sortedDocs = [...currencies].sort((a, b) => a.daysRemaining - b.daysRemaining)
  const shown = sortedDocs.slice(0, documentRows)
  for (const doc of shown) {
    const state: RequirementState =
      doc.status === "expired"
        ? "fail"
        : doc.status === "critical" || doc.status === "warning"
          ? "caution"
          : "ok"
    requirements.push({
      id: `doc-${doc.id ?? doc.code}`,
      group: "currency",
      label: doc.code,
      state,
      value: doc.daysRemaining <= 0 ? "Expired" : `${doc.daysRemaining}d`,
      // Metered against its own warning window: a document is "filling up" only
      // once it enters the window its owner chose to be warned at. Against the
      // whole validity period every document sits near full for a year and the
      // meter says nothing.
      progress:
        doc.daysRemaining <= 0
          ? 1
          : doc.warningDays > 0
            ? Math.max(0, 1 - doc.daysRemaining / doc.warningDays)
            : 0,
      daysUntil: doc.daysRemaining,
      detail: [
        doc.description || doc.code,
        `Expires ${doc.expiryDate}`,
        doc.issuingAuthority ? `Issued by ${doc.issuingAuthority}` : "",
      ].filter(Boolean),
      href: "/currencies",
      urgency:
        state === "fail"
          ? 700
          : state === "caution"
            ? 300 - Math.min(299, Math.max(0, doc.daysRemaining))
            : undefined,
      action:
        state === "fail"
          ? `${doc.code} expired — renew`
          : state === "caution"
            ? `${doc.code} expires in ${doc.daysRemaining}d`
            : undefined,
    })
  }
  const folded = sortedDocs.slice(shown.length)
  if (folded.length > 0) {
    requirements.push({
      id: "doc-rest",
      group: "currency",
      label: `${folded.length} more`,
      state: "ok",
      value: `${folded[0].daysRemaining}d+`,
      daysUntil: folded[0].daysRemaining,
      detail: folded.map((d) => `${d.code} ${d.daysRemaining}d`),
      href: "/currencies",
    })
  }

  // ── Rolling limits ──────────────────────────────────────────────────────
  const limitRows = [
    { id: "duty-14", label: "Duty 14d", forecastName: "14-day duty", cap: capacity.duty14Days },
    { id: "duty-28", label: "Duty 28d", forecastName: "28-day duty", cap: capacity.duty28Days },
    { id: "flight-28", label: "Flight 28d", forecastName: "28-day flight", cap: capacity.flight28Days },
    { id: "flight-365", label: "Flight 1y", forecastName: "12-month flight", cap: capacity.flight365Days },
  ]
  for (const row of limitRows) {
    const { used, limit } = row.cap
    const fraction = limit > 0 ? used / limit : 0
    // Prefix match, because the same limit is named two ways upstream: the
    // capacity calculation calls it "14-day duty" and the forecast appends the
    // regulation it comes from ("14-day duty (Reg 12a)"). An exact match reads
    // every forecast breach as belonging to no row and silently drops it.
    const forecast = forecastBreaches.some((n) => n.startsWith(row.forecastName))
    const state: RequirementState =
      limit <= 0
        ? "unknown"
        : fraction >= 1
          ? "fail"
          : fraction >= LIMIT_CAUTION || forecast
            ? "caution"
            : "ok"
    requirements.push({
      id: row.id,
      group: "limits",
      label: row.label,
      state,
      value: `${hours(used)} / ${hours(limit)}h`,
      progress: fraction,
      detail: [
        `${hours(Math.max(0, limit - used))}h remaining`,
        forecast ? "Forecast to breach on the current roster" : "",
      ].filter(Boolean),
      href: "/fdp",
      urgency:
        state === "fail"
          ? 800 + Math.round(fraction * 10)
          : state === "caution"
            ? Math.round(fraction * 300)
            : undefined,
      action:
        state === "fail"
          ? `${row.label} at limit`
          : state === "caution"
            ? `${hours(Math.max(0, limit - used))}h left on ${row.label}`
            : undefined,
    })
  }

  const counts = { ok: 0, caution: 0, fail: 0, total: requirements.length }
  for (const r of requirements) {
    if (r.state === "fail") counts.fail += 1
    else if (r.state === "caution") counts.caution += 1
    else counts.ok += 1
  }

  const flagged = requirements
    .filter((r) => r.urgency !== undefined)
    .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0))

  // Nothing flagged → whichever CURRENCY expires soonest. Rolling limits are
  // excluded by construction: they carry no `daysUntil` because they refill.
  const nearestExpiry = requirements
    .filter((r) => r.daysUntil !== undefined && r.id !== "doc-rest")
    .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0))[0]

  return {
    verdict: worst(requirements.map((r) => r.state)),
    requirements,
    binding: flagged[0] ?? nearestExpiry ?? requirements[0] ?? null,
    counts,
  }
}

function shortfallAction(toShort: number, ldgShort: number): string {
  const parts: string[] = []
  if (toShort > 0) parts.push(`${toShort} takeoff${toShort === 1 ? "" : "s"}`)
  if (ldgShort > 0) parts.push(`${ldgShort} landing${ldgShort === 1 ? "" : "s"}`)
  return `${parts.join(" and ")} required`
}
