/**
 * The legal dashboard's one derived model.
 *
 * The dashboard does not query or calculate anything itself: Dexie is the
 * source of truth, and this is a fast projection of it. Joining the standing
 * requirements (`legality.ts`) with where the pilot is in their duty day
 * (`duty-status.ts`) here — rather than in the component — is what lets the
 * panel be a dumb renderer, and what lets the whole answer be tested without a
 * browser.
 *
 * Pure: no React, no Dexie, no clock beyond the `now` handed in.
 */

import type { LegalityModel, Requirement, RequirementState } from "./legality"
import type { DutyStatus } from "./duty-status"

/**
 * The master annunciator, in the EFB sense: a pilot glancing at a phone in a
 * bright cockpit or a dark crew bus needs the state before they need any
 * number.
 *
 * Three states, not four — an "unknown" requirement is something the app cannot
 * answer for, which is a caution, not its own colour on a warning panel.
 */
export type AnnunciatorState = "current" | "warning" | "action_required"

export interface NextAction {
  tone: AnnunciatorState
  /** The imperative — "2 landings required", "Rest until 06:42". */
  headline: string
  /** One qualifier at most. */
  detail?: string
  href: string
}

export interface PilotStatus {
  state: AnnunciatorState
  /**
   * The tightest constraint — what a pilot actually wants when they are told
   * everything is current. "12 / 12 current" is noise; "Ldg 90d, 14 days" is
   * the thing that will bite first.
   */
  governing: Requirement | null
  nextAction: NextAction
  duty: DutyStatus
  legality: LegalityModel
  /** Live countdown target while rest is outstanding. Read off the duty state,
   *  which is where rest now lives. */
  legalAtUtc: string | null
}

const VERDICT_TO_STATE: Record<RequirementState, AnnunciatorState> = {
  ok: "current",
  unknown: "warning",
  caution: "warning",
  fail: "action_required",
}

/**
 * ECAM vocabulary, because that is the vocabulary the reader already has:
 * amber is a CAUTION, red demands an action before dispatch.
 */
export const ANNUNCIATOR_WORD: Record<AnnunciatorState, string> = {
  current: "CURRENT",
  warning: "CAUTION",
  action_required: "ACTION REQUIRED",
}

/** "1:20" — a duration, for a shortfall the reader has to act on. */
function hoursMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`
}

function clock(ms: number, tz?: string): string {
  const d = new Date(ms)
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(d)
  } catch {
    return d.toISOString().slice(11, 16)
  }
}

export function buildPilotStatus({
  legality,
  duty,
  timeZone,
  now = new Date(),
}: {
  legality: LegalityModel
  duty: DutyStatus
  /** IANA zone for any time the action line names. Defaults to the device's. */
  timeZone?: string
  now?: Date
}): PilotStatus {
  // An exceeded FDP outranks every standing requirement: it is the only thing
  // here that is happening RIGHT NOW rather than being true today.
  const fdpExceeded = duty.phase === "on_duty" && duty.active?.exceeded === true

  const state: AnnunciatorState = fdpExceeded
    ? "action_required"
    : VERDICT_TO_STATE[legality.verdict]

  const governing = legality.binding
  const restOutstanding = duty.rest !== null && !duty.rest.isLegalNow

  // A next duty the rest requirement does not reach. This is the pilot's to
  // catch — a roster can be wrong, and nothing else on the screen would say so
  // — and it is an ACTION because the fix is to tell the company, now, while
  // there is still time to move the duty.
  const nextDutyIllegal = duty.next?.legalAtReport === false

  return {
    state: nextDutyIllegal
      ? "action_required"
      : restOutstanding && state === "current"
        ? "warning"
        : state,
    governing,
    nextAction: deriveNextAction({ legality, duty, state, fdpExceeded, timeZone, now }),
    duty,
    legality,
    legalAtUtc: restOutstanding ? (duty.rest?.legalAtUtc ?? null) : null,
  }
}

/**
 * What to do next — the single most valuable line on the screen, and the one
 * thing a data-oriented dashboard never says.
 *
 * The order is the order a pilot would triage in: something wrong with the duty
 * in progress, then rest, then whatever requirement is binding, then nothing.
 */
function deriveNextAction({
  legality,
  duty,
  state,
  fdpExceeded,
  timeZone,
  now,
}: {
  legality: LegalityModel
  duty: DutyStatus
  state: AnnunciatorState
  fdpExceeded: boolean
  timeZone?: string
  now: Date
}): NextAction {
  if (fdpExceeded && duty.active) {
    return {
      tone: "action_required",
      headline: "FDP exceeded",
      detail: `${duty.active.route || "Current duty"} — notify company`,
      href: "/fdp",
    }
  }

  // Ahead of rest itself, because it is the one thing here with an external
  // remedy and a deadline: the duty is rostered inside the rest period, and
  // the company is the only party who can move it.
  if (duty.next?.legalAtReport === false && duty.rest) {
    return {
      tone: "action_required",
      headline: `Rest short by ${hoursMinutes(duty.next.restShortfallMinutes)}`,
      detail: `${duty.next.route || "Next duty"} reports before ${clock(
        Date.parse(duty.rest.legalAtUtc),
        timeZone,
      )} — notify company`,
      href: "/fdp",
    }
  }

  if (duty.rest && !duty.rest.isLegalNow) {
    const at = Date.parse(duty.rest.legalAtUtc)
    return {
      tone: "action_required",
      headline: `Rest until ${clock(at, timeZone)}`,
      detail: duty.next
        ? "Legal for the next duty"
        : "Earliest a duty may be planned",
      href: "/fdp",
    }
  }

  const binding = legality.binding
  if (binding?.action) {
    return {
      tone: binding.state === "fail" ? "action_required" : "warning",
      headline: binding.action,
      detail: binding.label,
      href: binding.href,
    }
  }

  // Nothing outstanding, but a duty IS in progress — so the useful line is
  // where the pilot is in it. "Nothing required" is true and useless while
  // sitting at the gate between sectors; the sector position is the thing they
  // would otherwise have to count off the chain themselves.
  if (duty.phase === "on_duty" && duty.active) {
    const flown = duty.active.legs.filter((l) => l.status === "complete").length
    const total = duty.active.legs.length || duty.active.sectorCount
    return {
      tone: "current",
      headline: total > 0 ? `Sector ${Math.min(flown + 1, total)} of ${total}` : "On duty",
      detail: duty.active.route || undefined,
      href: "/roster",
    }
  }

  // Nothing outstanding. The useful answer is then how long that lasts, and the
  // binding requirement already IS "what runs out first".
  if (duty.next) {
    return {
      tone: "current",
      headline: `Report ${clock(duty.next.reportMs, timeZone)}`,
      detail: duty.next.route || `${duty.next.sectorCount} sectors`,
      href: "/roster",
    }
  }

  return {
    tone: state,
    headline: "Nothing required",
    detail: binding ? `${binding.label} ${binding.value}` : undefined,
    href: "/fdp",
  }
}
