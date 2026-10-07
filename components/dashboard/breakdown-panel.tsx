"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { usePreferences } from "@/components/providers/preferences-provider"
import {
  AUTO_FILL_DISPLAY,
  formatDecimalHours,
  type AutoFillKey,
  type AutoFillMinutes,
  type DashboardAggregates,
} from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

/**
 * How the period's hours break down — by role flown and by what was flown.
 *
 * Last on the page on purpose. It is the only block that answers a question
 * nobody asks before a flight; everything above it is either "can I go" or
 * "what have I done", and this is "how does it split".
 *
 * Two things are deliberately NOT here, though the data has them: night and
 * simulator time. Both are already stated in the period summary at the top —
 * night as half of the day/night bar, sim as its own figure — and the old
 * dashboard printed each of them twice, once there and once as another ring in
 * this grid.
 */

/** Night and sim are shown in the period summary; a second copy here is the
 *  repetition this rebuild set out to remove. */
const SHOWN_ELSEWHERE: ReadonlySet<AutoFillKey> = new Set<AutoFillKey>(["night", "simInst"])

export function BreakdownPanel({
  byAutoFillField,
  totalBlockMinutes,
  byEngine,
  topTypes,
  className,
}: {
  byAutoFillField: AutoFillMinutes
  /** The denominator is BLOCK time — the same clock as the hero figure. */
  totalBlockMinutes: number
  byEngine: DashboardAggregates["byEngine"]
  topTypes: DashboardAggregates["topTypes"]
  className?: string
}) {
  const { preferences } = usePreferences()

  const roles = React.useMemo(
    () =>
      AUTO_FILL_DISPLAY.filter(
        ({ key }) =>
          preferences.autoFill[key] &&
          !SHOWN_ELSEWHERE.has(key) &&
          (byAutoFillField[key] ?? 0) > 0,
      ).map(({ key, label }) => ({ key, label, minutes: byAutoFillField[key] ?? 0 })),
    [preferences.autoFill, byAutoFillField],
  )

  const engineTotal = byEngine.se + byEngine.me + byEngine.jet
  const maxType = Math.max(...topTypes.map((t) => t.minutes), 1)

  /**
   * The engine split is drawn only when there is a split to draw.
   *
   * An airline pilot flies one engine class, so with a single class the
   * "part-to-whole" bar is a full-width fill at 100% with a one-item legend
   * under it — and the figure it states is the block total already given as the
   * hero figure at the top of the page. A single-series bar is not a chart; it
   * is a restatement.
   */
  const engineClasses = [
    { key: "se", label: "SE", minutes: byEngine.se, tone: "bg-chart-2" },
    { key: "me", label: "ME", minutes: byEngine.me, tone: "bg-chart-4" },
    { key: "jet", label: "Jet", minutes: byEngine.jet, tone: "bg-chart-3" },
  ].filter((e) => e.minutes > 0)
  const showEngineSplit = engineClasses.length > 1

  if (roles.length === 0 && !showEngineSplit && topTypes.length === 0) return null

  return (
    <section
      className={cn(
        "@container rounded-3xl border border-border/60 bg-card/70 p-4 shadow-sm",
        className,
      )}
      aria-label="Period breakdown"
    >
      {/* One column on a phone, two side by side once there is room — the same
          two blocks in the same order either way. */}
      <div className="grid gap-x-6 gap-y-4 @[34rem]:grid-cols-2">
        {roles.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              Role &amp; conditions
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 @[22rem]:grid-cols-3 @[34rem]:grid-cols-2">
              {roles.map((r) => (
                <MagnitudeRow
                  key={r.key}
                  label={r.label}
                  value={`${formatDecimalHours(r.minutes)}h`}
                  fraction={totalBlockMinutes > 0 ? r.minutes / totalBlockMinutes : 0}
                />
              ))}
            </div>
          </div>
        )}

        {(showEngineSplit || topTypes.length > 0) && (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Aircraft</p>
              <Link
                href="/aircraft"
                className="group inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Fleet
                <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </div>

            {showEngineSplit && (
              <>
                {/* Part-to-whole. The 2px surface gaps separate the segments —
                    no stroke is drawn around any of them. */}
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  {engineClasses.map((e) => (
                    <Segment key={e.key} value={e.minutes} total={engineTotal} className={e.tone} />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  {engineClasses.map((e) => (
                    <Key
                      key={e.key}
                      className={e.tone}
                      label={e.label}
                      value={formatDecimalHours(e.minutes)}
                    />
                  ))}
                </div>
              </>
            )}

            {topTypes.length > 0 && (
              <div className={cn("space-y-1.5", showEngineSplit && "mt-3")}>
                {topTypes.map((t) => (
                  <MagnitudeRow
                    key={t.type}
                    label={t.type}
                    value={`${formatDecimalHours(t.minutes)}h`}
                    fraction={t.minutes / maxType}
                    inline
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * A magnitude meter — ONE hue, deliberately not the status ramp.
 *
 * These are quantities, not states: forty hours of SIC is neither good nor bad.
 * Painting them green/amber/red would spend the reserved status colours on
 * something that has no status, and — worse — would teach the reader that the
 * colour means the same thing here as it does in the legality panel, where it
 * means whether they can legally fly.
 */
function MagnitudeRow({
  label,
  value,
  fraction,
  inline,
}: {
  label: string
  value: string
  fraction: number
  /** Label and bar on one line — for a short list of long-ish labels. */
  inline?: boolean
}) {
  const bar = (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-primary/15">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
      />
    </div>
  )

  if (inline) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-11 shrink-0 truncate text-[11px] font-medium text-foreground">
          {label}
        </span>
        <div className="min-w-0 flex-1">{bar}</div>
        <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground">
          {value}
        </span>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="truncate text-[11px] text-muted-foreground">{label}</span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
          {value}
        </span>
      </div>
      <div className="mt-0.5">{bar}</div>
    </div>
  )
}

/** One fill of a stacked bar, with the 2px surface gap that separates it from
 *  the next. The gap is omitted on an empty segment so it can't show as a nick
 *  in an otherwise continuous bar. */
function Segment({
  value,
  total,
  className,
}: {
  value: number
  total: number
  className: string
}) {
  if (value <= 0) return null
  return (
    <>
      <div
        className={cn("h-full rounded-full", className)}
        style={{ width: `${(value / total) * 100}%` }}
      />
      <div className="w-[2px] shrink-0 last:hidden" />
    </>
  )
}

function Key({
  className,
  label,
  value,
}: {
  className: string
  label: string
  value: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", className)} aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  )
}
