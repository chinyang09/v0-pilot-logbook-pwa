"use client"

import * as React from "react"
import Link from "next/link"
import { Check, TriangleAlert, OctagonAlert, ArrowUpRight } from "lucide-react"

import { GROUP_LABELS, type LegalityModel, type RequirementState } from "@/lib/utils/dashboard/legality"
import { useLegality } from "@/hooks/data/use-legality"
import { usePageActive } from "@/hooks/use-page-active"
import type { NinetyDayCurrency } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

import { RequirementRow } from "./requirement-row"

/**
 * "Can I fly?" — answered as the requirements themselves.
 *
 * This is the first thing on the dashboard because it is the first thing a
 * pilot asks, and it is the one question the old dashboard answered worst: the
 * pieces were spread over three cards (a rest pill in the limits stack, a
 * current/not-current chip in the takeoffs card, expiries only in the bell
 * dropdown) and none of them said what the whole set added up to.
 *
 * The headline is a verdict, but the verdict is not the content — it is derived
 * from the grid under it, and the grid is always visible. A pilot who reads
 * "Legal to fly" and wants to know *why* does not have to go anywhere.
 */

const VERDICT: Record<
  RequirementState,
  { word: string; icon: React.ComponentType<{ className?: string }>; text: string; ring: string }
> = {
  ok: { word: "Legal to fly", icon: Check, text: "text-chart-2", ring: "bg-chart-2/12" },
  caution: { word: "Legal — watch", icon: TriangleAlert, text: "text-chart-4", ring: "bg-chart-4/12" },
  fail: { word: "Not legal", icon: OctagonAlert, text: "text-destructive", ring: "bg-destructive/12" },
  unknown: { word: "Incomplete", icon: TriangleAlert, text: "text-muted-foreground", ring: "bg-muted" },
}

/**
 * A 1Hz clock, gated twice over: it runs only while rest is actually
 * outstanding AND this tab is the one on screen.
 *
 * The dashboard is keep-alive — mounted on first visit and never unmounted — so
 * an ungated interval re-renders this panel once a second for the rest of the
 * session, including while the user is scrolling the logbook. There is exactly
 * one thing to tick and most of the time it isn't there.
 */
function useCountdown(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    // Catch up immediately on re-activation, from a callback rather than the
    // effect body (see the react-compiler lint note in CLAUDE.md).
    const first = window.setTimeout(tick, 0)
    const id = window.setInterval(tick, 1000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [active])
  return now
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

export function LegalityPanel({
  recency,
  className,
}: {
  recency: NinetyDayCurrency
  className?: string
}) {
  const { legality } = useLegality(recency)
  const isVisibleTab = usePageActive("/")
  const now = useCountdown(isVisibleTab && !!legality.legalAtUtc)

  return (
    <LegalityPanelView
      legality={legality}
      now={now}
      className={className}
    />
  )
}

/** The presentational half — pure props, so it renders without the DB. */
export function LegalityPanelView({
  legality,
  now,
  className,
}: {
  legality: LegalityModel
  now: number
  className?: string
}) {
  const verdict = VERDICT[legality.verdict]
  const VerdictIcon = verdict.icon

  const restMs = legality.legalAtUtc
    ? new Date(legality.legalAtUtc).getTime() - now
    : 0
  const countdown = restMs > 0 ? formatCountdown(restMs) : null

  return (
    <section
      className={cn(
        // @container, not viewport breakpoints: the dashboard lives in a
        // resizable split panel, so how much room this panel actually has has
        // nothing to do with the window's width.
        "@container rounded-2xl border border-border/60 bg-card/70 p-3 shadow-sm",
        className,
      )}
      aria-label="Flight legality"
    >
      {/* ── Verdict ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            verdict.ring,
          )}
        >
          <VerdictIcon className={cn("h-5 w-5", verdict.text)} aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className={cn("text-base font-semibold leading-tight", verdict.text)}>
            {countdown ?? verdict.word}
          </p>
          {/* The binding constraint — what is stopping the pilot, or what runs
              out first when nothing is. One line, no sentence. */}
          {legality.binding && (
            <p className="truncate text-[11px] leading-tight text-muted-foreground">
              {countdown ? "rest to go · " : ""}
              {legality.binding.label} {legality.binding.value}
            </p>
          )}
        </div>

        {/* The tally. Each count carries the SAME icon as the rows it counts —
            a bare amber "4" beside a grey "7/11" is state by colour alone, and
            this is the one panel nobody can afford to misread. */}
        <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
          {legality.counts.fail > 0 && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-destructive">
              <OctagonAlert className="h-3 w-3" aria-hidden="true" />
              {legality.counts.fail}
              <span className="sr-only">not met</span>
            </span>
          )}
          {legality.counts.caution > 0 && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-chart-4">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              {legality.counts.caution}
              <span className="sr-only">close to limit</span>
            </span>
          )}
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            <Check className="h-3 w-3" aria-hidden="true" />
            {legality.counts.ok}
            <span className="sr-only">
              met, of {legality.counts.total} requirements
            </span>
          </span>
        </div>
      </div>

      {/* ── The requirements themselves ─────────────────────────────────── */}
      {/* Grouped, in the order a pilot checks them: can I start a duty at all
          (rest), am I current (recency), have I got hours left (limits), are my
          papers in date (documents). */}
      <div className="mt-2.5 space-y-2">
        {GROUP_LABELS.map(({ group, label }) => {
          const rows = legality.requirements.filter((r) => r.group === group)
          if (rows.length === 0) return null
          return (
            <div key={group}>
              <p className="px-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {label}
              </p>
              {/* Two columns on a phone, more as the panel widens — the same
                  rows throughout, never a different arrangement. This is what
                  lets the whole requirement set be one look on a 390px screen
                  and stay the same shape on a 1400px one. */}
              <div className="grid grid-cols-2 gap-x-1 @[26rem]:grid-cols-3 @[40rem]:grid-cols-4 @[56rem]:grid-cols-6">
                {rows.map((r) => (
                  <RequirementRow
                    key={r.id}
                    requirement={r}
                    valueOverride={
                      r.id === "rest" && countdown ? countdown : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <Link
        href="/fdp"
        className="group mt-2 inline-flex items-center gap-1 px-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        Duty detail
        <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    </section>
  )
}
