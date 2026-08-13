/**
 * "Am I legal to fly?" — as a list of requirements, not a verdict.
 *
 * A banner reading LEGAL is worth very little to a pilot. It cannot be checked,
 * it cannot be planned against, and on the day it flips to NOT LEGAL it does not
 * say which of half a dozen things went. So this module does not compute a
 * verdict and explain it afterwards: it computes the REQUIREMENTS, each with its
 * own state, and the verdict is nothing more than the worst one of them.
 *
 * Four groups, which together are everything the app knows about a pilot's
 * fitness to operate:
 *
 * | Group | Requirement | Source |
 * |---|---|---|
 * | Rest | rest since last debrief vs. the minimum | CAAS Reg 3, via `calculateRestUntilLegal` |
 * | Recency | 3 takeoffs + 3 landings in 90 days | the logbook |
 * | Limits | duty 14d/28d, flight 28d/365d | CAAS Reg 12 / 107, via `calculateCapacity` |
 * | Documents | medical, licence, OPC, IR, line check… | the currencies table |
 *
 * Every requirement reduces to the same four fields — a label, a state, one
 * readout and a fraction — so the UI renders one row shape for all of them and a
 * new requirement is a new entry rather than a new layout.
 *
 * Pure: no React, no Dexie, no clock of its own beyond the `now` handed in.
 */

import type { CurrencyWithStatus } from "@/types/entities/roster.types"
import type { NinetyDayCurrency } from "@/lib/utils/dashboard-aggregate"

export type RequirementState = "ok" | "caution" | "fail" | "unknown"

export type RequirementGroup = "rest" | "recency" | "limits" | "documents"

export interface Requirement {
  id: string
  group: RequirementGroup
  /** Two words at most — the row is read in a grid, not a sentence. */
  label: string
  state: RequirementState
  /** The readout: "6 / 3", "68 / 90h", "142d". */
  value: string
  /** How full the requirement is, 0..1. `undefined` when nothing meaningful
   *  can be metered (an unknown, or a fold row). Values above 1 are clamped by
   *  the meter, not here — the overage is real and the state carries it. */
  progress?: number
  /** Where tapping the row goes. */
  href: string
  /**
   * Set only when a requirement is not met or is close to it. The panel's
   * headline is the single most pressing one of these, so a pilot reads the
   * problem rather than hunting the grid for a red row.
   */
  urgency?: number
}

export interface LegalityModel {
  /** The worst state across every requirement. */
  verdict: RequirementState
  requirements: Requirement[]
  /**
   * The one requirement closest to stopping the pilot flying — the binding
   * constraint. `null` only when there are no requirements at all.
   */
  binding: Requirement | null
  /** ISO instant the pilot becomes legal, when rest is outstanding. */
  legalAtUtc: string | null
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

/** Recency is worth flagging before it lapses, not on the day. */
const RECENCY_CAUTION_DAYS = 14

function hours(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  // A rolling total is read against a two- or three-figure limit, so one
  // decimal is precision nobody uses and it costs the row its width.
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

/** The four rolling limits, in the order a pilot reads them. */
export interface CapacityInput {
  duty14Days: { used: number; limit: number; remaining: number }
  duty28Days: { used: number; limit: number; remaining: number }
  flight28Days: { used: number; limit: number; remaining: number }
  flight365Days: { used: number; limit: number; remaining: number }
}

export interface RestInput {
  isLegalNow: boolean
  restElapsedMinutes: number
  requiredRestMinutes: number
  legalAtUtc: string
}

export interface LegalityInput {
  /** `null` when there is no completed duty to rest from. */
  rest: RestInput | null
  recency: NinetyDayCurrency
  capacity: CapacityInput
  /** Rolling limits a future schedule is projected to breach, by limit name. */
  forecastBreaches?: string[]
  currencies: CurrencyWithStatus[]
  /** How many documents get their own row before the rest are folded up. */
  documentRows?: number
  now?: Date
}

/**
 * How many document rows are shown individually.
 *
 * A line pilot carries a dozen or more currencies, and a grid of twelve chips
 * that are all green is not information — it is the reason the panel would stop
 * being readable at a glance. The nearest few expiries are the ones that can
 * change state before the next look; the remainder are folded into one row that
 * states how many are clear, so nothing is hidden, only summarised.
 */
const DEFAULT_DOCUMENT_ROWS = 3

export function buildLegalityModel({
  rest,
  recency,
  capacity,
  forecastBreaches = [],
  currencies,
  documentRows = DEFAULT_DOCUMENT_ROWS,
  now = new Date(),
}: LegalityInput): LegalityModel {
  const requirements: Requirement[] = []
  const todayIso = toIsoDate(now)

  // ── Rest ────────────────────────────────────────────────────────────────
  // Urgency is the outstanding rest itself: a pilot who is 20 minutes short is
  // closer to flying than one who is nine hours short, and the headline should
  // say so.
  if (!rest) {
    requirements.push({
      id: "rest",
      group: "rest",
      label: "Since duty",
      state: "ok",
      value: "Rested",
      href: "/fdp",
    })
  } else if (rest.isLegalNow) {
    requirements.push({
      id: "rest",
      group: "rest",
      label: "Since duty",
      state: "ok",
      value: "Ready",
      progress: 1,
      href: "/fdp",
    })
  } else {
    const short = Math.max(0, rest.requiredRestMinutes - rest.restElapsedMinutes)
    requirements.push({
      id: "rest",
      group: "rest",
      label: "Since duty",
      state: "fail",
      // The live countdown replaces this in the UI; the static form is what a
      // non-ticking consumer (a test, a screenshot) reads.
      value: `${Math.floor(short / 60)}h ${short % 60}m`,
      progress:
        rest.requiredRestMinutes > 0
          ? rest.restElapsedMinutes / rest.requiredRestMinutes
          : 1,
      href: "/fdp",
      urgency: 1000 - Math.min(999, short),
    })
  }

  // ── Recency ─────────────────────────────────────────────────────────────
  const recencyRows: Array<{ id: string; label: string; count: number }> = [
    { id: "recency-to", label: "T/O 90d", count: recency.takeoffs },
    { id: "recency-ldg", label: "Ldg 90d", count: recency.landings },
  ]
  const daysToLapse = recency.lapseIso ? daysBetween(todayIso, recency.lapseIso) : null
  for (const row of recencyRows) {
    const met = row.count >= 3
    const lapsingSoon =
      met && daysToLapse !== null && daysToLapse <= RECENCY_CAUTION_DAYS
    requirements.push({
      id: row.id,
      group: "recency",
      label: row.label,
      state: !met ? "fail" : lapsingSoon ? "caution" : "ok",
      value: !met
        ? `${row.count} / 3`
        : lapsingSoon
          ? `${daysToLapse}d left`
          : `${row.count} / 3`,
      progress: Math.min(1, row.count / 3),
      href: "/logbook",
      urgency: !met ? 900 : lapsingSoon ? 400 - Math.min(399, daysToLapse) : undefined,
    })
  }

  // ── Rolling limits ──────────────────────────────────────────────────────
  // The readout is used-of-limit and the meter is the same fraction, so the row
  // reads the same way as every other: how full is this requirement.
  const limitRows: Array<{ id: string; label: string; forecastName: string; cap: CapacityInput[keyof CapacityInput] }> = [
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
      href: "/fdp",
      urgency:
        state === "fail"
          ? 800 + Math.round(fraction * 10)
          : state === "caution"
            ? Math.round(fraction * 300)
            : undefined,
    })
  }

  // ── Documents ───────────────────────────────────────────────────────────
  // Nearest expiry first. An EXPIRED document is a hard stop; one inside its own
  // critical/warning window is still valid, so it cautions rather than fails —
  // the distinction is the whole point of the two thresholds a currency carries.
  const sortedDocs = [...currencies].sort(
    (a, b) => a.daysRemaining - b.daysRemaining,
  )
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
      group: "documents",
      label: doc.code,
      state,
      value: doc.daysRemaining <= 0 ? "Expired" : `${doc.daysRemaining}d`,
      // Metered against its own warning window: a document is "filling up" only
      // once it enters the window its owner chose to be warned at. Against the
      // whole validity period every document would sit near full for a year and
      // the meter would say nothing.
      progress:
        doc.daysRemaining <= 0
          ? 1
          : doc.warningDays > 0
            ? Math.max(0, 1 - doc.daysRemaining / doc.warningDays)
            : 0,
      href: "/currencies",
      urgency:
        state === "fail"
          ? 700
          : state === "caution"
            ? 300 - Math.min(299, Math.max(0, doc.daysRemaining))
            : undefined,
    })
  }
  const folded = sortedDocs.length - shown.length
  if (folded > 0) {
    requirements.push({
      id: "doc-rest",
      group: "documents",
      label: "Other docs",
      state: "ok",
      value: `${folded} valid`,
      href: "/currencies",
    })
  }

  const counts = { ok: 0, caution: 0, fail: 0, total: requirements.length }
  for (const r of requirements) {
    if (r.state === "fail") counts.fail += 1
    else if (r.state === "caution") counts.caution += 1
    else counts.ok += 1
  }

  // The binding constraint: the most urgent flagged requirement, or — when
  // nothing is flagged — whichever is fullest, because that is the one that will
  // flag first.
  const flagged = requirements
    .filter((r) => r.urgency !== undefined)
    .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0))
  const binding =
    flagged[0] ??
    [...requirements]
      .filter((r) => r.progress !== undefined && r.group === "limits")
      .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0] ??
    requirements[0] ??
    null

  return {
    verdict: worst(requirements.map((r) => r.state)),
    requirements,
    binding,
    legalAtUtc: rest && !rest.isLegalNow ? rest.legalAtUtc : null,
    counts,
  }
}

/** Display order + label for the four groups. */
export const GROUP_LABELS: ReadonlyArray<{ group: RequirementGroup; label: string }> = [
  { group: "rest", label: "Rest" },
  { group: "recency", label: "Recency" },
  { group: "limits", label: "Limits" },
  { group: "documents", label: "Docs" },
]
