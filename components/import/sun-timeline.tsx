/**
 * Sunrise / sunset arc.
 *
 * The sun's path across the horizon for one airport on one day. The flight
 * event sits ABOVE the arc — icon and time together, on a leader line dropping
 * to the horizon — while the two sun crossings sit BELOW it, each on its own
 * leader and marked with an icon rather than a word.
 *
 * Reading it needs no legend: if the plane's leader meets the horizon on the
 * dark side of the curve, it was night.
 */

"use client";

import { useId } from "react";
import { PlaneTakeoff, PlaneLanding, Sunrise, Sunset } from "lucide-react";
import { OptionPair } from "./option-pair";

function toMinutes(hhmm: string): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

const DAY_MINUTES = 24 * 60;

// SVG geometry (viewBox units) — deliberately shallow. The arc only has to
// show which side of the horizon an event fell on, and height here is height
// added to every card in the list.
const W = 300;
const H = 40;
const HORIZON_Y = 21;
const AMPLITUDE_DAY = 13;
const AMPLITUDE_NIGHT = 9;

/**
 * Sun elevation as a fraction, using sunrise/sunset as the zero crossings:
 * +1 at solar noon, -1 at solar midnight. An idealised shape whose crossings
 * are the real computed times.
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
const pctOf = (minute: number) =>
  Math.min(92, Math.max(8, (minute / DAY_MINUTES) * 100));

export interface SunTimelineProps {
  kind: "takeoff" | "landing";
  /** Airport label, already formatted to the user's ICAO/IATA preference. */
  airport?: string;
  /** UTC HH:MM of the event. */
  eventUtc?: string;
  /** UTC HH:MM of the sun crossings at that airport, same day. */
  sunriseUtc?: string | null;
  sunsetUtc?: string | null;
  /** Zulu display (adds "Z"); otherwise shifted to the airport's local clock. */
  zulu?: boolean;
  tzOffsetHours?: number;
  /** Rendered on the header row, opposite the title. */
  action?: React.ReactNode;
}

export function SunTimeline({
  kind,
  airport,
  eventUtc,
  sunriseUtc,
  sunsetUtc,
  zulu = true,
  tzOffsetHours = 0,
  action,
}: SunTimelineProps) {
  const gradId = useId().replace(/:/g, "");
  const rise = sunriseUtc ? toMinutes(sunriseUtc) : null;
  const set = sunsetUtc ? toMinutes(sunsetUtc) : null;
  const event = eventUtc ? toMinutes(eventUtc) : null;

  if (rise === null || set === null) return null;

  const dayLength = ((set - rise) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;

  const points: Array<[number, number]> = [];
  for (let m = 0; m <= DAY_MINUTES; m += 8) {
    points.push([xOf(m), yOf(elevation(m, rise, dayLength))]);
  }
  const curve = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const fill = `M0,${HORIZON_Y} L${curve} L${W},${HORIZON_Y} Z`;

  const eventElev = event !== null ? elevation(event, rise, dayLength) : null;
  const eventX = event !== null ? xOf(event) : null;
  const isNight = eventElev !== null && eventElev < 0;

  const Icon = kind === "takeoff" ? PlaneTakeoff : PlaneLanding;

  // Times follow the user's display preference. The curve stays plotted in
  // UTC — shifting it would move the sun, not the labels.
  const fmt = (utc: string): string => {
    if (zulu) return `${utc}Z`;
    const mins = toMinutes(utc);
    if (mins === null) return utc;
    const shifted =
      ((mins + Math.round(tzOffsetHours * 60)) % DAY_MINUTES + DAY_MINUTES) %
      DAY_MINUTES;
    return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(
      shifted % 60
    ).padStart(2, "0")}`;
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-baseline gap-1.5 text-[10px]">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
            {kind === "takeoff" ? "Takeoff" : "Landing"}
          </span>
          {airport && <span className="font-medium">{airport}</span>}
        </span>
        {action}
      </div>

      {/* Event: icon + time, above the arc */}
      <div className="relative h-4">
        {event !== null && eventUtc && (
          <div
            className="absolute flex -translate-x-1/2 items-center gap-1 whitespace-nowrap"
            style={{ left: `${pctOf(event)}%` }}
          >
            <Icon className="h-3 w-3 text-primary" aria-hidden />
            <span className="text-[10px] font-semibold tabular-nums text-foreground">
              {fmt(eventUtc)}
            </span>
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label={
          `${kind} at ${eventUtc ? fmt(eventUtc) : "unknown"}, sunrise ` +
          `${fmt(sunriseUtc!)}, sunset ${fmt(sunsetUtc!)} — ` +
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

        <path d={fill} fill={`url(#day-${gradId})`} clipPath={`url(#above-${gradId})`} />
        <path d={fill} fill={`url(#night-${gradId})`} clipPath={`url(#below-${gradId})`} />

        <line
          x1="0"
          y1={HORIZON_Y}
          x2={W}
          y2={HORIZON_Y}
          stroke="currentColor"
          strokeWidth="0.6"
          className="text-muted-foreground/40"
        />
        <polyline
          points={curve}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          className="text-muted-foreground/50"
        />

        {/* Sun crossings: solid leaders dropping to their labels below. */}
        {[rise, set].map((m, i) => (
          <g key={i}>
            <line
              x1={xOf(m)}
              y1={HORIZON_Y}
              x2={xOf(m)}
              y2={H}
              stroke="currentColor"
              strokeWidth="0.7"
              className="text-muted-foreground/45"
            />
            <circle
              cx={xOf(m)}
              cy={HORIZON_Y}
              r="1.8"
              fill="var(--color-background)"
              stroke="currentColor"
              strokeWidth="0.9"
              className="text-muted-foreground"
            />
          </g>
        ))}

        {/* The event's leader runs from its icon down to the HORIZON. */}
        {eventX !== null && (
          <>
            <line
              x1={eventX}
              y1="0"
              x2={eventX}
              y2={HORIZON_Y}
              stroke="currentColor"
              strokeWidth="0.9"
              className="text-primary/80"
            />
            <circle cx={eventX} cy={HORIZON_Y} r="1.9" fill="var(--color-primary)" />
          </>
        )}
      </svg>

      {/* Sun crossings: icon + time, below the arc */}
      <div className="relative h-4">
        {[
          { minute: set, utc: sunsetUtc!, Ico: Sunset },
          { minute: rise, utc: sunriseUtc!, Ico: Sunrise },
        ].map(({ minute, utc, Ico }) => (
          <div
            key={utc}
            className="absolute flex -translate-x-1/2 items-center gap-1 whitespace-nowrap"
            style={{ left: `${pctOf(minute)}%` }}
          >
            <Ico className="h-3 w-3 text-muted-foreground/80" aria-hidden />
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {fmt(utc)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Day/night choice — our sun calculation (default) vs the company's record. */
export function DayNightChoice({
  ours,
  company,
  useCompany,
  onChange,
}: {
  ours: string;
  company: string;
  useCompany: boolean;
  onChange?: (useCompany: boolean) => void;
}) {
  return (
    <OptionPair
      left={{ caption: "Calculated", value: ours }}
      right={{ caption: "Company", value: company }}
      rightActive={useCompany}
      onChange={onChange}
      size="sm"
    />
  );
}
