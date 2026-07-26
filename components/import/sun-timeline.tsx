/**
 * Sunrise / sunset timeline.
 *
 * Replaces the old "T/O day/night differs from company — NIGHT" sentence with a
 * picture: a day/night bar for the airport on the day in question, with the
 * takeoff (or landing) marked on it. Whether the event fell in daylight is then
 * something you SEE rather than something you have to take on trust.
 *
 * Below it, a two-option toggle: our sun-position result (the default) or the
 * company's recorded figure.
 */

"use client";

import { cn } from "@/lib/utils";
import { Sunrise, Sunset } from "lucide-react";

function toMinutes(hhmm: string): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

const DAY_MINUTES = 24 * 60;
const pct = (minutes: number) => (minutes / DAY_MINUTES) * 100;

export interface SunTimelineProps {
  /** "T/O" or "LDG" — what the marker represents. */
  label: string;
  /** Airport the sun times belong to. */
  airport?: string;
  /** UTC HH:MM of the event. */
  eventUtc?: string;
  /** UTC HH:MM of civil twilight crossings at that airport, same day. */
  sunriseUtc?: string | null;
  sunsetUtc?: string | null;
  /** Our sun-position verdict for the event. */
  status?: "day" | "night";
}

/**
 * The bar runs 00:00 → 24:00 UTC. Daylight is the span between sunrise and
 * sunset; when sunset precedes sunrise (a polar-ish or wrapped day) the
 * daylight span wraps through midnight and is drawn as two pieces.
 */
export function SunTimeline({
  label,
  airport,
  eventUtc,
  sunriseUtc,
  sunsetUtc,
  status,
}: SunTimelineProps) {
  const rise = sunriseUtc ? toMinutes(sunriseUtc) : null;
  const set = sunsetUtc ? toMinutes(sunsetUtc) : null;
  const event = eventUtc ? toMinutes(eventUtc) : null;

  // Daylight segments as [startPct, widthPct].
  const daySegments: Array<[number, number]> = [];
  if (rise !== null && set !== null) {
    if (set > rise) {
      daySegments.push([pct(rise), pct(set - rise)]);
    } else {
      // Daylight wraps midnight.
      daySegments.push([0, pct(set)]);
      daySegments.push([pct(rise), pct(DAY_MINUTES - rise)]);
    }
  }

  return (
    <div className="w-full">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {airport && <span className="font-medium">{airport}</span>}
        {eventUtc && <span className="text-muted-foreground">{eventUtc}Z</span>}
        {sunriseUtc && (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            <Sunrise className="h-3 w-3" aria-hidden />
            {sunriseUtc}Z
          </span>
        )}
        {sunsetUtc && (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            <Sunset className="h-3 w-3" aria-hidden />
            {sunsetUtc}Z
          </span>
        )}
      </div>

      {/* The bar */}
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-indigo-950 dark:bg-indigo-950"
        role="img"
        aria-label={
          `${label} at ${eventUtc ?? "unknown time"} UTC` +
          (status ? ` — ${status}` : "") +
          (sunriseUtc ? `, sunrise ${sunriseUtc}Z` : "") +
          (sunsetUtc ? `, sunset ${sunsetUtc}Z` : "")
        }
      >
        {daySegments.map(([left, width], i) => (
          <div
            key={i}
            className="absolute inset-y-0 bg-gradient-to-r from-amber-500/70 via-amber-300 to-amber-500/70"
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        ))}

        {/* Event marker */}
        {event !== null && (
          <div
            className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-foreground shadow-[0_0_0_1.5px_var(--color-background)]"
            style={{ left: `${pct(event)}%` }}
          />
        )}
      </div>

      {/* Axis ticks — 00 / 06 / 12 / 18 / 24 UTC */}
      <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-muted-foreground/60">
        {["00", "06", "12", "18", "24"].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
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
