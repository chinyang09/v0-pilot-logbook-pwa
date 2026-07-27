/**
 * Sunrise / sunset arc.
 *
 * Draws the sun's path across the horizon for one airport on one day: the
 * curve rises at sunrise, peaks at solar noon and sets at sunset, with daylight
 * filled amber above the horizon line and night filled dark below it. The
 * takeoff or landing is pinned on the curve with a plane icon, so "was this at
 * night?" is answered by looking rather than by reading a verdict.
 *
 * Sunrise and sunset are labelled at their own positions along the axis, as is
 * the event itself.
 */

"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { PlaneTakeoff, PlaneLanding } from "lucide-react";

function toMinutes(hhmm: string): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

const DAY_MINUTES = 24 * 60;

// SVG geometry (viewBox units). Deliberately flat — the arc only has to show
// which side of the horizon an event fell on, and a tall curve made the flight
// card unnecessarily deep.
const W = 300;
const H = 56;
const ICON_Y = 9;
const HORIZON_Y = 36;
const AMPLITUDE_DAY = 17;
const AMPLITUDE_NIGHT = 12;

/**
 * Sun elevation as a fraction, using sunrise/sunset as the zero crossings:
 * +1 at solar noon, -1 at solar midnight. Not astronomically exact — it is a
 * faithful *shape* whose crossings are the real computed times, which is what
 * makes the picture trustworthy.
 */
function elevation(minute: number, sunrise: number, dayLength: number): number {
  const phase = ((minute - sunrise) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
  if (phase <= dayLength) {
    return dayLength === 0 ? 0 : Math.sin((Math.PI * phase) / dayLength);
  }
  const nightLength = DAY_MINUTES - dayLength;
  const nightPhase = phase - dayLength;
  return nightLength === 0 ? 0 : -Math.sin((Math.PI * nightPhase) / nightLength);
}

const xOf = (minute: number) => (minute / DAY_MINUTES) * W;
const yOf = (elev: number) =>
  HORIZON_Y - elev * (elev >= 0 ? AMPLITUDE_DAY : AMPLITUDE_NIGHT);

interface AxisMark {
  minute: number;
  caption: string;
  value: string;
  emphasis?: boolean;
}

/**
 * A row of labels pinned at their own time positions. Sun crossings and the
 * flight event live on opposite sides of the curve, so a row never has to
 * resolve a collision between them.
 */
function AxisLabels({
  marks,
  align,
}: {
  marks: AxisMark[];
  align: "above" | "below";
}) {
  if (marks.length === 0) return null;
  return (
    <div className={cn("relative h-6", align === "above" ? "mb-0.5" : "mt-0.5")}>
      {marks.map((mark) => (
        <div
          key={`${mark.caption}-${mark.minute}`}
          className="absolute -translate-x-1/2 text-center leading-tight"
          style={{
            left: `${Math.min(94, Math.max(6, (mark.minute / DAY_MINUTES) * 100))}%`,
          }}
        >
          <div className="text-[8px] uppercase tracking-wide text-muted-foreground/70">
            {mark.caption}
          </div>
          <div
            className={cn(
              "text-[10px] tabular-nums",
              mark.emphasis
                ? "font-semibold text-foreground"
                : "text-muted-foreground"
            )}
          >
            {mark.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface SunTimelineProps {
  /** What the marker represents. */
  kind: "takeoff" | "landing";
  /** Airport the sun times belong to. */
  airport?: string;
  /** UTC HH:MM of the event. */
  eventUtc?: string;
  /** UTC HH:MM of the sun crossings at that airport, same day. */
  sunriseUtc?: string | null;
  sunsetUtc?: string | null;
  /**
   * Show times as Zulu (UTC, "Z"-suffixed) per the user's display preference.
   * When false, times are shifted into the airport's local time by
   * `tzOffsetHours` and shown without a suffix.
   */
  zulu?: boolean;
  /** Airport UTC offset in hours; used only when `zulu` is false. */
  tzOffsetHours?: number;
}

export function SunTimeline({
  kind,
  airport,
  eventUtc,
  sunriseUtc,
  sunsetUtc,
  zulu = true,
  tzOffsetHours = 0,
}: SunTimelineProps) {
  const gradId = useId().replace(/:/g, "");
  const rise = sunriseUtc ? toMinutes(sunriseUtc) : null;
  const set = sunsetUtc ? toMinutes(sunsetUtc) : null;
  const event = eventUtc ? toMinutes(eventUtc) : null;

  // Without both crossings there is no arc to draw.
  if (rise === null || set === null) return null;

  const dayLength = ((set - rise) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;

  // Sample the curve across the whole 24h window.
  const step = 8;
  const points: Array<[number, number]> = [];
  for (let m = 0; m <= DAY_MINUTES; m += step) {
    points.push([xOf(m), yOf(elevation(m, rise, dayLength))]);
  }
  const curve = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

  // Fills: clip the curve area against the horizon on each side.
  const dayFill = `M0,${HORIZON_Y} L${curve} L${W},${HORIZON_Y} Z`;
  const nightFill = dayFill; // same path; split by clip rects below.

  const eventElev =
    event !== null ? elevation(event, rise, dayLength) : null;
  const eventX = event !== null ? xOf(event) : null;
  const eventY = eventElev !== null ? yOf(eventElev) : null;
  const isNight = eventElev !== null && eventElev < 0;

  const Icon = kind === "takeoff" ? PlaneTakeoff : PlaneLanding;

  // Times follow the user's display preference: Zulu with a "Z" suffix, or the
  // airport's local clock with none. The curve itself is always plotted in UTC
  // — shifting it would move the sun, not the labels.
  const fmt = (utc: string): string => {
    if (zulu) return `${utc}Z`;
    const mins = toMinutes(utc);
    if (mins === null) return utc;
    const shifted =
      ((mins + Math.round(tzOffsetHours * 60)) % DAY_MINUTES + DAY_MINUTES) %
      DAY_MINUTES;
    const h = String(Math.floor(shifted / 60)).padStart(2, "0");
    const m = String(shifted % 60).padStart(2, "0");
    return `${h}:${m}`;
  };

  return (
    <div className="w-full">
      <div className="mb-0.5 flex items-baseline gap-1.5 text-[10px]">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          {kind === "takeoff" ? "Takeoff" : "Landing"}
        </span>
        {airport && <span className="font-medium">{airport}</span>}
      </div>

      {/* Sun crossings sit ABOVE the curve; the flight event sits below. */}
      <AxisLabels
        align="above"
        marks={[
          { minute: rise, caption: "Sunrise", value: fmt(sunriseUtc!) },
          { minute: set, caption: "Sunset", value: fmt(sunsetUtc!) },
        ]}
      />

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label={
          `${kind} at ${eventUtc ? fmt(eventUtc) : "unknown"}, ` +
          `sunrise ${fmt(sunriseUtc!)}, sunset ${fmt(sunsetUtc!)} — ` +
          (isNight ? "night" : "day")
        }
      >
        <defs>
          <linearGradient id={`day-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-status-warning)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--color-status-warning)" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id={`night-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.45 0.08 265)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="oklch(0.35 0.07 265)" stopOpacity="0.8" />
          </linearGradient>
          <clipPath id={`above-${gradId}`}>
            <rect x="0" y="0" width={W} height={HORIZON_Y} />
          </clipPath>
          <clipPath id={`below-${gradId}`}>
            <rect x="0" y={HORIZON_Y} width={W} height={H - HORIZON_Y} />
          </clipPath>
        </defs>

        <path d={dayFill} fill={`url(#day-${gradId})`} clipPath={`url(#above-${gradId})`} />
        <path d={nightFill} fill={`url(#night-${gradId})`} clipPath={`url(#below-${gradId})`} />

        {/* Horizon */}
        <line
          x1="0"
          y1={HORIZON_Y}
          x2={W}
          y2={HORIZON_Y}
          stroke="currentColor"
          strokeWidth="0.75"
          className="text-muted-foreground/40"
        />

        {/* The sun's path */}
        <polyline
          points={curve}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="text-muted-foreground/50"
        />

        {/* Sunrise / sunset crossings */}
        {[rise, set].map((m, i) => (
          <g key={i}>
            <line
              x1={xOf(m)}
              y1={HORIZON_Y - AMPLITUDE_DAY - 4}
              x2={xOf(m)}
              y2={HORIZON_Y + AMPLITUDE_NIGHT + 4}
              stroke="currentColor"
              strokeWidth="0.5"
              strokeDasharray="2 2"
              className="text-muted-foreground/35"
            />
            <circle
              cx={xOf(m)}
              cy={HORIZON_Y}
              r="2.5"
              fill="var(--color-background)"
              stroke="currentColor"
              strokeWidth="1"
              className="text-muted-foreground"
            />
          </g>
        ))}

        {/* The event: a tick where it meets the curve, with a leader line
            running UP to the icon so the marker never sits on top of the arc. */}
        {eventX !== null && eventY !== null && (
          <g>
            <line
              x1={eventX}
              y1={eventY}
              x2={eventX}
              y2={ICON_Y + 6}
              stroke="currentColor"
              strokeWidth="0.85"
              className="text-primary/70"
            />
            <circle
              cx={eventX}
              cy={eventY}
              r="2.4"
              fill="var(--color-primary)"
              stroke="var(--color-background)"
              strokeWidth="1"
            />
            <Icon
              x={eventX - 6}
              y={ICON_Y - 6}
              width={12}
              height={12}
              className="text-primary"
              stroke="currentColor"
            />
          </g>
        )}
      </svg>

      <AxisLabels
        align="below"
        marks={
          event !== null && eventUtc
            ? [
                {
                  minute: event,
                  caption: kind === "takeoff" ? "T/O" : "LDG",
                  value: fmt(eventUtc),
                  emphasis: true,
                },
              ]
            : []
        }
      />
    </div>
  );
}

function ChoiceOption({
  active,
  caption,
  value,
  onSelect,
}: {
  active: boolean;
  caption: string;
  value: string;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={!onSelect}
      onClick={(e) => {
        // The card is a <label>; don't let the click toggle its checkbox.
        e.preventDefault();
        e.stopPropagation();
        onSelect?.();
      }}
      className={cn(
        "flex-1 rounded-md px-2 py-1 text-left transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted/60"
      )}
    >
      <span className="block text-[9px] uppercase tracking-wide opacity-70">
        {caption}
      </span>
      <span className="block text-[11px] font-semibold">{value}</span>
    </button>
  );
}

/** Two-option segmented control: our calculation (default) vs the company's. */
export function DayNightChoice({
  ours,
  company,
  useCompany,
  onChange,
}: {
  /** e.g. "Night" */
  ours: string;
  /** e.g. "Day" */
  company: string;
  useCompany: boolean;
  onChange?: (useCompany: boolean) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Day or night classification"
      className="mt-1.5 flex gap-1 rounded-lg bg-muted/40 p-1"
    >
      <ChoiceOption
        active={!useCompany}
        caption="Calculated"
        value={ours}
        onSelect={onChange ? () => onChange(false) : undefined}
      />
      <ChoiceOption
        active={useCompany}
        caption="Company"
        value={company}
        onSelect={onChange ? () => onChange(true) : undefined}
      />
    </div>
  );
}
