/**
 * Each area of the flight dashboard, said in a pilot's words rather than the
 * regulation's: a TONE (go, check, stop — or info / idle where an area holds
 * no verdict) and ONE line, so a glance at the page answers "am I good to go,
 * and if not, where". The detail behind each is its expanded card's job.
 *
 * The owner, Nov 2026: "one look good to go or something flagging", "doesn't
 * have to be so technical", "no repetition". So no area says another's fact:
 * the duty card says rest, the currency card says documents, the aircraft card
 * the tail and its gate.
 *
 * Pure — every clock is injected — so the wording is tested.
 */

import type { DutyStatus } from "./duty-status"
import { formatDutyClock, formatRestSpan } from "./duty-status"
import type { Requirement } from "./legality"
import type { DutyLookups } from "@/hooks/use-duty-lookups"
import type { CrewMate, DestinationVisits } from "./flight-brief"
import type { StationBrief } from "@/lib/weather/brief"

/** go = fine; check = look at it; stop = act on it; info = no verdict to give; idle = nothing to say yet. */
export type AreaTone = "go" | "check" | "stop" | "info" | "idle"

export interface AreaStatus {
  tone: AreaTone
  /** The one line — in words, never a code. */
  headline: string
  /** A second, quieter line, or nothing. */
  detail?: string
}

export type Clock = (ms: number) => string

/* ── Readiness ───────────────────────────────────────────────────────────── */

const RANK: Record<AreaTone, number> = { stop: 3, check: 2, go: 1, info: 0, idle: 0 }

/** The page's one answer: the worst verdict any area gives. */
export function readiness(areas: AreaStatus[]): { tone: "go" | "check" | "stop" | "idle"; headline: string; flagged: number } {
  const judged = areas.filter((a) => a.tone === "go" || a.tone === "check" || a.tone === "stop")
  const flagged = judged.filter((a) => a.tone !== "go").length
  if (judged.length === 0) return { tone: "idle", headline: "Nothing to check yet", flagged: 0 }
  const worst = judged.reduce((w, a) => (RANK[a.tone] > RANK[w.tone] ? a : w))
  if (worst.tone === "stop") return { tone: "stop", headline: "Action needed", flagged }
  if (worst.tone === "check") return { tone: "check", headline: flagged === 1 ? "1 thing to check" : `${flagged} things to check`, flagged }
  return { tone: "go", headline: "Good to go", flagged: 0 }
}

/* ── Duty & rest ─────────────────────────────────────────────────────────── */

export function dutyArea(duty: DutyStatus, clock: Clock): AreaStatus {
  const { phase, active, next, rest, standby } = duty
  if (phase === "on_duty" && active) {
    if (active.exceeded) return { tone: "stop", headline: "Duty limit exceeded", detail: "Tell the company" }
    if (active.maxFdpMinutes <= 0) return { tone: "info", headline: active.notFdp || "On duty" }
    const left = Math.max(0, active.maxFdpMinutes - active.fdpElapsedMinutes)
    const flown = active.legs.filter((l) => l.status === "complete").length
    const total = active.legs.length || active.sectorCount
    return {
      tone: active.fdpElapsedMinutes / active.maxFdpMinutes >= 0.8 ? "check" : "go",
      headline: `${formatDutyClock(left)} of duty time left`,
      detail: total > 0 ? `Sector ${Math.min(flown + 1, total)} of ${total}` : undefined,
    }
  }
  if (next?.legalAtReport === false) {
    return { tone: "stop", headline: `Rest ${formatDutyClock(next.restShortfallMinutes)} short of report`, detail: "Tell the company" }
  }
  if (standby) {
    return {
      tone: "info",
      headline: `On standby until ${clock(standby.endMs)}`,
      detail: standby.activated ? "Called out" : "Not called",
    }
  }
  if (rest && !rest.isLegalNow) {
    const until = Date.parse(rest.legalAtUtc)
    return { tone: "check", headline: `Resting until ${clock(until)}`, detail: `${formatRestSpan(rest.elapsedMinutes)} rested so far` }
  }
  if (rest) return { tone: "go", headline: "Rested — legal for duty", detail: `${formatRestSpan(rest.elapsedMinutes)} rested` }
  return { tone: "idle", headline: "No duty logged yet" }
}

/* ── Aircraft ────────────────────────────────────────────────────────────── */

/** "45m", "2h 10m". */
function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

/**
 * The aeroplane for the next leg: where it is, and the gate it leaves from
 * once published. Not a verdict on the pilot, so a late inbound is a CHECK at
 * most — the aeroplane being on the ground is the good answer.
 */
export function aircraftArea(input: {
  registration: string
  hasLegs: boolean
  /** null = not asked (the duty is too far off). */
  lookups: DutyLookups | null
  loading: boolean
  /** The next leg's departure gate, "" until published. */
  gate: string
  nowMs: number
  clock: Clock
}): AreaStatus {
  const { registration: reg, lookups, gate, nowMs, clock } = input
  // The gate rides on the second line: beside the tail it truncated.
  const at = gate ? `Gate ${gate}` : ""
  const withGate = (detail?: string) => [at, detail].filter(Boolean).join(" · ") || undefined
  if (!input.hasLegs) return { tone: "idle", headline: "No flight ahead" }
  if (!reg) return { tone: "idle", headline: "Aircraft not assigned yet" }
  if (!lookups) return { tone: "info", headline: reg, detail: input.loading ? "Checking…" : "Checked from 18h before the duty" }
  const w = lookups.inbound
  if (!w) return { tone: "info", headline: reg, detail: withGate() }
  if (w.status === "failed") return { tone: "idle", headline: reg, detail: withGate("Couldn't check where it is") }
  if (w.status === "missing") return { tone: "info", headline: reg, detail: withGate("No recent flights found") }
  const inbound = w.whereabouts.inbound
  if (!inbound) return { tone: "go", headline: reg, detail: withGate("No earlier flight today") }
  const from = inbound.origin?.iata || inbound.origin?.icao || ""
  // The flight bringing it in, by number — the owner's ask: a gate or a time
  // means little apart from the flight it belongs to.
  const flight = [inbound.flightNumber, from && `from ${from}`].filter(Boolean).join(" ")
  const arrMs = inbound.arrival ? Date.parse(inbound.arrival) : null
  if (inbound.status === "landed") {
    return { tone: "go", headline: `${reg} is on the ground`, detail: withGate(`${flight}${arrMs !== null ? `, ${ago(nowMs - arrMs)} ago` : ""}`) }
  }
  if (inbound.status === "airborne") {
    return { tone: "go", headline: `${reg} is inbound`, detail: withGate(`${flight}${arrMs !== null ? `, lands ${clock(arrMs)}` : ""}`) }
  }
  const std = inbound.scheduledDeparture ? Date.parse(inbound.scheduledDeparture) : null
  const late = std !== null && nowMs > std + 20 * 60_000
  return {
    tone: late ? "check" : "info",
    headline: late ? `${reg} hasn't left ${from} yet` : `${reg} is at ${from}`,
    detail: withGate(`${inbound.flightNumber || "Inbound"}${std !== null ? ` due off ${clock(std)}` : ""}`),
  }
}

/* ── Weather ─────────────────────────────────────────────────────────────── */

/** A hazard as a pilot says it — never the METAR code. */
export function hazardWords(h: string): string {
  const code = h.replace(/^(TEMPO|PROB\d{2}) /, "")
  if (/TS/.test(code)) return "Thunderstorms"
  if (code === "CB") return "Storm clouds"
  if (code === "TCU") return "Towering cumulus"
  if (code === "FG") return "Fog"
  if (code === "FZ") return "Freezing conditions"
  if (code === "GR") return "Hail or ice"
  if (code === "SN") return "Snow"
  if (code === "SQ") return "Squalls"
  if (code === "FC") return "Funnel cloud"
  if (code === "VA") return "Volcanic ash"
  if (code === "DS") return "Dust or sand storm"
  if (/^G?\d+KT$/.test(code)) return "Strong wind"
  if (/^Vis /.test(code)) return "Poor visibility"
  if (/^Ceiling /.test(code)) return "Low cloud"
  if (code.startsWith("+")) return "Heavy precipitation"
  return code
}

export function weatherArea(input: {
  briefs: StationBrief[]
  asked: boolean
  failed: boolean
  loading: boolean
  checkedAt: number | null
  code: (icao: string) => string
}): AreaStatus {
  const { briefs, code } = input
  if (!input.asked) return { tone: "idle", headline: briefs.length ? "Forecast from 30h before the duty" : "No flight ahead" }
  if (input.failed) return { tone: "idle", headline: "Weather unavailable" }
  if (input.loading && !input.checkedAt) return { tone: "idle", headline: "Checking the weather…" }
  const worst = briefs.find((b) => b.hazards.length > 0) ?? briefs.find((b) => b.worst === "IFR" || b.worst === "LIFR")
  if (worst) {
    const what = worst.hazards.length ? hazardWords(worst.hazards[0]) : "Low cloud or visibility"
    const others = briefs.filter((b) => b !== worst && (b.hazards.length > 0 || b.worst === "IFR" || b.worst === "LIFR"))
    return {
      tone: "check",
      headline: `${what} at ${code(worst.station)}`,
      detail: others.length ? `Also at ${others.map((b) => code(b.station)).join(", ")}` : undefined,
    }
  }
  const places = briefs.map((b) => code(b.station))
  return {
    tone: "go",
    headline: places.length ? `Fine at ${places.length > 2 ? "every airport" : places.join(" and ")}` : "No reports",
  }
}

/* ── Crew ────────────────────────────────────────────────────────────────── */

/** "Woon Kok Heng, Benson" → "Woon Kok Heng". */
const shortName = (name: string) => name.split(",")[0].trim()

export function crewArea(crew: CrewMate[], day: (ymd: string) => string): AreaStatus {
  if (crew.length === 0) return { tone: "idle", headline: "No crew listed" }
  const lead = crew.find((c) => c.role === "PIC") ?? crew[0]
  const more = crew.length - 1
  return {
    tone: "info",
    headline: `${lead.role === "PIC" ? "Capt " : ""}${shortName(lead.name)}${more > 0 ? ` +${more}` : ""}`,
    detail: lead.last ? `Last flew together ${day(lead.last.date)}` : "First time flying together",
  }
}

/* ── Destination ─────────────────────────────────────────────────────────── */

/** "today", "yesterday", "12 days ago", "3 months ago", "2 years ago". */
export function sinceText(ymd: string, nowMs: number): string {
  const days = Math.floor((nowMs - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 60) return `${days} days ago`
  if (days < 730) return `${Math.round(days / 30)} months ago`
  return `${Math.round(days / 365)} years ago`
}

export function destinationArea(
  dests: DestinationVisits[],
  nameOf: (icao: string) => string,
  nowMs: number,
): AreaStatus {
  if (dests.length === 0) return { tone: "idle", headline: "No flight ahead" }
  const d = dests[0]
  return {
    tone: "info",
    headline: nameOf(d.icao),
    detail: d.last ? `Last there ${sinceText(d.last.date, nowMs)}` : "Your first visit",
  }
}

/* ── Currency ────────────────────────────────────────────────────────────── */

export function currencyArea(reqs: Requirement[]): AreaStatus {
  if (reqs.length === 0) return { tone: "idle", headline: "No currencies tracked" }
  const flagged = reqs
    .filter((r) => r.state !== "ok")
    .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0) || (a.daysUntil ?? 9e9) - (b.daysUntil ?? 9e9))
  const worst = flagged[0]
  if (worst) {
    const more = flagged.length - 1
    return {
      tone: worst.state === "fail" ? "stop" : "check",
      headline: worst.action ?? `${worst.label} · ${worst.value}`,
      detail: more > 0 ? `+${more} more to look at` : worst.action ? worst.label : undefined,
    }
  }
  const nearest = [...reqs].filter((r) => r.daysUntil !== undefined).sort((a, b) => a.daysUntil! - b.daysUntil!)[0]
  return {
    tone: "go",
    headline: reqs.length === 1 ? `${reqs[0].label} current` : `All ${reqs.length} current`,
    detail: nearest ? `Next to renew: ${nearest.label}, ${nearest.daysUntil} days` : undefined,
  }
}

/* ── Limits ──────────────────────────────────────────────────────────────── */

export function limitsArea(limits: Requirement[]): AreaStatus {
  if (limits.length === 0) return { tone: "idle", headline: "No limits worked out yet" }
  const fail = limits.find((r) => r.state === "fail")
  if (fail) return { tone: "stop", headline: `Over the ${fail.label} limit`, detail: fail.value }
  const caution = limits.find((r) => r.state === "caution" || r.state === "unknown")
  if (caution) {
    const left = caution.detail?.find((d) => d.label === "Remaining")?.value
    return { tone: "check", headline: `Close to the ${caution.label} limit`, detail: left ? `${left} left` : caution.value }
  }
  const tightest = [...limits].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0]
  return {
    tone: "go",
    headline: "Plenty of room",
    detail: tightest ? `Fullest: ${tightest.label}, ${Math.round((tightest.progress ?? 0) * 100)}% used` : undefined,
  }
}
