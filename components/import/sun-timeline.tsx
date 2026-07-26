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

// SVG geometry (viewBox units).
const W = 300;
const H = 78;
const HORIZON_Y = 46;
const AMPLITUDE_DAY = 32;
const AMPLITUDE_NIGHT = 22;

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

/** Horizontal gap (in % of the axis) below which two labels would collide. */
const LABEL_MIN_GAP_PCT = 16;

/**
 * Lay labels out under the axis, dropping any that would overlap a
 * previously-placed one onto a second row. A takeoff minutes away from
 * sunrise is the normal case, not an edge case, so they must both stay
 * readable.
 */
function AxisLabels({ marks }: { marks: AxisMark[] }) {
  const placed = [...marks]
    .sort((a, b) => a.minute - b.minute)
    .map((mark) => ({
      ...mark,
      leftPct: Math.min(94, Math.max(6, (mark.minute / DAY_MINUTES) * 100)),
      row: 0,
    }));

  for (let i = 1; i < placed.length; i++) {
    for (let j = 0; j < i; j++) {
      if (
        placed[j].row === placed[i].row &&
        Math.abs(placed[j].leftPct - placed[i].leftPct) < LABEL_MIN_GAP_PCT
      ) {
        placed[i].row = placed[j].row + 1;
      }
    }
  }

  const rows = Math.max(...placed.map((p) => p.row)) + 1;

  return (
    <div className="relative mt-0.5" style={{ height: `${rows * 1.6 + 0.2}rem` }}>
      {placed.map((mark) => (
        <div
          key={`${mark.caption}-${mark.minute}`}
          className="absolute -translate-x-1/2 text-center leading-tight"
          style={{ left: `${mark.leftPct}%`, top: `${mark.row * 1.6}rem` }}
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
}

export function SunTimeline({
  kind,
  airport,
  eventUtc,
  sunriseUtc,
  sunsetUtc,
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

  return (
    <div className="w-full">
      <div className="mb-0.5 flex items-baseline gap-1.5 text-[10px]">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          {kind === "takeoff" ? "Takeoff" : "Landing"}
        </span>
        {airport && <span className="font-medium">{airport}</span>}
        <span className="text-muted-foreground/70">all times UTC</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label={
          `${kind} at ${eventUtc ?? "unknown"}Z, ` +
          `sunrise ${sunriseUtc}Z, sunset ${sunsetUtc}Z — ` +
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

        {/* The event, pinned on the curve */}
        {eventX !== null && eventY !== null && (
          <g>
            <line
              x1={eventX}
              y1={eventY}
              x2={eventX}
              y2={HORIZON_Y}
              stroke="currentColor"
              strokeWidth="0.75"
              className="text-primary/60"
            />
            <circle
              cx={eventX}
              cy={eventY}
              r="9"
              fill="var(--color-background)"
              stroke="currentColor"
              strokeWidth="1.25"
              className="text-primary"
            />
            <Icon
              x={eventX - 5.5}
              y={eventY - 5.5}
              width={11}
              height={11}
              className="text-primary"
              stroke="currentColor"
            />
          </g>
        )}
      </svg>

      {/* Labels pinned along the axis, stacked when they would collide */}
      <AxisLabels
        marks={[
          { minute: rise, caption: "Sunrise", value: `${sunriseUtc}` },
          { minute: set, caption: "Sunset", value: `${sunsetUtc}` },
          ...(event !== null && eventUtc
            ? [
                {
                  minute: event,
                  caption: kind === "takeoff" ? "T/O" : "LDG",
                  value: eventUtc,
                  emphasis: true,
                },
              ]
            : []),
        ]}
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
