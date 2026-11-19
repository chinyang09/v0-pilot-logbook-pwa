"use client"

/**
 * The flight dashboard's faces (Nov 2026 redesign — the owner: "creative and
 * attention grabbing", "one look good to go or something flagging", "not so
 * technical", "no repetition").
 *
 * | | What it says at a glance |
 * |---|---|
 * | `ReadinessHero` | the page's ONE answer — a ring with a segment per area, lit by that area's verdict, and "Good to go" / "1 thing to check" / "Action needed" — beside the chosen duty as a boarding pass: when, which flights, the route, and a countdown to what happens next |
 * | `AreaRow` | one area's verdict in a sentence, its light (✓ ! ✕) on the right; a flagged area's card takes the colour |
 *
 * Every word comes from `lib/utils/dashboard/area-status.ts`, so a face and
 * its card cannot disagree, and no area says another's fact.
 */

import * as React from "react"
import { Check, ChevronRight, CloudSun, Gauge, GripVertical, MapPin, OctagonAlert, Plane, ShieldCheck, Timer, TriangleAlert, Users } from "lucide-react"
import type { AreaStatus, AreaTone } from "@/lib/utils/dashboard/area-status"
import type { DashboardArea } from "@/hooks/use-dashboard-layout"
import { cn } from "@/lib/utils"
import type { FlightBrief } from "./model"

export const AREA_TITLE: Record<DashboardArea, string> = {
  duty: "Duty & Rest",
  aircraft: "Aircraft",
  weather: "Weather",
  crew: "Crew",
  destination: "Destination",
  currency: "Currency",
  limits: "Limits",
}

const AREA_ICON: Record<DashboardArea, React.ComponentType<{ className?: string }>> = {
  duty: Timer,
  aircraft: Plane,
  weather: CloudSun,
  crew: Users,
  destination: MapPin,
  currency: ShieldCheck,
  limits: Gauge,
}

/** The status ramp, by tone — never colour alone: each verdict has its own icon. */
export const AREA_TONE: Record<
  AreaTone,
  { text: string; tile: string; card: string; ring: string; light: React.ComponentType<{ className?: string }> | null; label: string }
> = {
  go: { text: "text-chart-2", tile: "bg-chart-2/15 text-chart-2", card: "", ring: "var(--chart-2)", light: Check, label: "Good" },
  check: {
    text: "text-status-warning",
    tile: "bg-chart-4/20 text-status-warning",
    card: "border-chart-4/50 bg-chart-4/[0.07]",
    ring: "var(--chart-4)",
    light: TriangleAlert,
    label: "Check",
  },
  stop: {
    text: "text-destructive",
    tile: "bg-destructive/15 text-destructive",
    card: "border-destructive/50 bg-destructive/[0.07]",
    ring: "var(--destructive)",
    light: OctagonAlert,
    label: "Action needed",
  },
  info: { text: "text-foreground", tile: "bg-muted text-foreground", card: "", ring: "color-mix(in oklch, var(--muted-foreground) 55%, transparent)", light: null, label: "" },
  idle: { text: "text-muted-foreground", tile: "bg-muted text-muted-foreground", card: "", ring: "color-mix(in oklch, var(--muted-foreground) 25%, transparent)", light: null, label: "" },
}

/** A flagged area's card edge and wash — what makes it stand out of the column. */
export const areaCardClass = (tone: AreaTone) => AREA_TONE[tone].card

/* ── One area ────────────────────────────────────────────────────────────── */

export function AreaRow({
  id,
  status,
  arranging = false,
  opened = false,
}: {
  id: DashboardArea
  status: AreaStatus
  arranging?: boolean
  /** The header of its own open card: no "open me" chevron. */
  opened?: boolean
}) {
  const Icon = AREA_ICON[id]
  const tone = AREA_TONE[status.tone]
  const Light = tone.light
  return (
    <div className="flex w-full items-center gap-3">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tone.tile)}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-snug text-foreground" suppressHydrationWarning>
          {status.headline}
        </span>
        <span className="block truncate text-xs leading-snug text-muted-foreground" suppressHydrationWarning>
          <span className="font-semibold uppercase tracking-wider text-[10px]">{AREA_TITLE[id]}</span>
          {status.detail && <span> · {status.detail}</span>}
        </span>
      </span>
      {!arranging &&
        (Light ? (
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", tone.tile)} aria-label={tone.label}>
            <Light className="h-4 w-4" aria-hidden />
          </span>
        ) : opened ? null : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
        ))}
    </div>
  )
}

/** The handle a row is dragged by while the areas are being arranged. */
export function AreaGrip({ onPointerDown, label }: { onPointerDown: (e: React.PointerEvent) => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={`Move ${label}`}
      onPointerDown={onPointerDown}
      style={{ touchAction: "none" }}
      className="flex h-11 w-11 cursor-grab items-center justify-center rounded-full text-muted-foreground active:cursor-grabbing"
    >
      <GripVertical className="h-5 w-5" aria-hidden />
    </button>
  )
}

/* ── The page's answer ───────────────────────────────────────────────────── */

const RING = 76
const STROKE = 8

/**
 * A segment per area, lit by its verdict — the one look that says whether
 * anything needs the pilot before they read a word. Areas with no verdict to
 * give (crew, destination) are drawn quiet.
 */
function ReadinessRing({ tones, verdict }: { tones: AreaTone[]; verdict: AreaTone }) {
  const r = (RING - STROKE) / 2
  const c = 2 * Math.PI * r
  const gap = tones.length > 1 ? 7 : 0
  const seg = c / Math.max(1, tones.length) - gap
  const Icon = AREA_TONE[verdict].light ?? Check
  return (
    <div className="relative shrink-0" style={{ width: RING, height: RING }}>
      <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} className="-rotate-90" aria-hidden>
        {tones.map((t, i) => (
          <circle
            key={i}
            cx={RING / 2}
            cy={RING / 2}
            r={r}
            fill="none"
            stroke={AREA_TONE[t].ring}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0.1, seg)} ${c}`}
            strokeDashoffset={-(i * (seg + gap)) - gap / 2}
          />
        ))}
      </svg>
      <span className={cn("absolute inset-0 flex items-center justify-center", AREA_TONE[verdict].text)}>
        <Icon className="h-8 w-8" aria-hidden />
      </span>
    </div>
  )
}

/** Where the duty stepper sits on the hero: on the boarding pass's first line. */
export const HERO_STEPPER_CLASS = "right-2 top-[99px]"

/** "in 2h 55m", "in 25m", "now". */
function countdown(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m <= 0) return "now"
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `in ${h}h ${String(m % 60).padStart(2, "0")}m`
  return `in ${Math.round(h / 24)} days`
}

/** What happens next on the chosen duty, and when: report, a departure, a landing. */
export function nextEvent(brief: FlightBrief): string | null {
  const { duty, clock, now } = brief
  if (duty.atMs === null) return null
  if (!duty.current && duty.atMs > now) return `Report ${clock(duty.atMs)} · ${countdown(duty.atMs - now)}`
  for (let i = 0; i < duty.times.length; i++) {
    const t = duty.times[i]
    if (t.departMs !== null && t.departMs > now && !duty.legs[i]?.outTime) {
      return `${duty.legs[i]?.flightNumber || "Departs"} off ${clock(t.departMs)} · ${countdown(t.departMs - now)}`
    }
  }
  const last = duty.times[duty.times.length - 1]
  if (last?.arriveMs && last.arriveMs > now) return `Lands ${clock(last.arriveMs)} · ${countdown(last.arriveMs - now)}`
  return duty.current ? "On duty" : null
}

/** The route as codes: "SIN → CGK → SIN". */
export function routeOf(brief: FlightBrief): string {
  const { duty, code } = brief
  if (duty.legs.length === 0) return duty.period?.route?.replace(/-/g, " → ") ?? ""
  return [code(duty.legs[0].departureIcao, duty.legs[0].departureIata), ...duty.legs.map((l) => code(l.arrivalIcao, l.arrivalIata))].join(" → ")
}

export function ReadinessHero({
  brief,
  tones,
  verdict,
}: {
  brief: FlightBrief
  tones: AreaTone[]
  verdict: { tone: AreaTone; headline: string; flagged: number }
}) {
  const { duty, day } = brief
  const numbers = duty.legs.map((l) => l.flightNumber).filter(Boolean)
  const event = nextEvent(brief)
  const tint =
    verdict.tone === "stop"
      ? "from-destructive/[0.18]"
      : verdict.tone === "check"
        ? "from-chart-4/[0.18]"
        : verdict.tone === "go"
          ? "from-chart-2/[0.16]"
          : "from-muted-foreground/[0.08]"
  return (
    <>
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent to-60%", tint)} />
      {/* The answer. */}
      <div className="relative flex h-[76px] items-center gap-4">
        <ReadinessRing tones={tones} verdict={verdict.tone} />
        <div className="min-w-0">
          <p className={cn("truncate text-2xl font-bold leading-tight tracking-tight", AREA_TONE[verdict.tone].text)}>{verdict.headline}</p>
          <p className="truncate text-[13px] text-muted-foreground">
            {verdict.tone === "go"
              ? "Nothing needs you right now"
              : verdict.tone === "idle"
                ? "Add flights to see where you stand"
                : verdict.flagged === 1
                  ? "It is highlighted below"
                  : "They are highlighted below"}
          </p>
        </div>
      </div>
      {/* The boarding pass's tear line — the notches are the page showing through. */}
      <div aria-hidden className="relative -mx-3 h-4">
        <span className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
        <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
        <span className="absolute inset-x-4 top-1/2 border-t border-dashed border-border" />
      </div>
      {/* The duty it is about. */}
      <div className="relative">
        {duty.atMs === null ? (
          <p className="py-1 text-sm text-muted-foreground">Nothing rostered ahead</p>
        ) : (
          <>
            <p className="truncate pr-24 text-[10px] font-semibold uppercase leading-[14px] tracking-[0.14em] text-muted-foreground" suppressHydrationWarning>
              {duty.current ? "Now" : duty.index === 0 ? "Next" : "Later"} · {day(duty.atMs)}
            </p>
            <p className="mt-0.5 truncate text-lg font-bold leading-snug tracking-tight text-foreground">
              {numbers.length > 0 ? numbers.join(" · ") : "Duty"}
              <span className="ml-1.5 text-[15px] font-medium text-muted-foreground">{routeOf(brief)}</span>
            </p>
            {event && (
              <p className="truncate text-[13px] font-semibold tabular-nums text-primary" suppressHydrationWarning>
                {event}
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}
