"use client"

/**
 * The currency DOT CALENDAR (the owner, Nov 2026): a dot a day, a week to a
 * column, looking ahead from today (`currency-dots.ts` lays it out) — and each
 * currency's expiry one dot lit on it.
 *
 * | | On the tile | In the card |
 * |---|---|---|
 * | an expiry | ink, amber or red by its state — dark cockpit: nothing nominal is coloured | ink — the SELECTED one alone in colour (its state's, else the accent) |
 * | the closest | larger, ringed | larger, ringed |
 * | a tap | opens the card | selects that currency, a second tap deselects; the days from today to it LIGHT UP in turn — how many days, at a glance |
 *
 * Today is an ink ring; the days already gone in the first week are not drawn.
 * Drawn as one SVG scaled to the width, so a 13-week tile and a 53-week card
 * come out about the same height.
 */

import * as React from "react"
import { dotAt, dotLayout, type LookAhead } from "@/lib/utils/dashboard/currency-dots"
import type { Requirement } from "@/lib/utils/dashboard/legality"
import { cn } from "@/lib/utils"

const PITCH = 10
const R = 3.3

export interface DotMark {
  key: string
  name: string
  state: Requirement["state"]
  /** The day it falls on (a day already gone is today). */
  ymd: string
}

const STATE_FILL: Record<Requirement["state"], string> = {
  ok: "fill-foreground",
  caution: "fill-status-warning",
  unknown: "fill-status-warning",
  fail: "fill-destructive",
}

export function CurrencyDots({
  today,
  ahead,
  marks,
  closest,
  selected = null,
  onSelect,
  className,
}: {
  today: string
  ahead: LookAhead
  marks: DotMark[]
  /** The mark to ring: the soonest. */
  closest: string | null
  selected?: string | null
  onSelect?: (key: string | null) => void
  className?: string
}) {
  const layout = React.useMemo(() => dotLayout(today, ahead), [today, ahead])
  // The marks by the day they fall on (two on one day: the first in the list leads).
  const byIndex = React.useMemo(() => {
    const m = new Map<number, DotMark[]>()
    for (const mk of marks) {
      const at = dotAt(layout, mk.ymd)
      if (!at) continue
      m.set(at.index, [...(m.get(at.index) ?? []), mk])
    }
    return m
  }, [marks, layout])
  const W = layout.weeks * PITCH
  const H = 7 * PITCH
  const pos = (index: number) => {
    const n = layout.offset + index
    return { cx: Math.floor(n / 7) * PITCH + PITCH / 2, cy: (n % 7) * PITCH + PITCH / 2 }
  }

  // The selected mark's day: the sweep runs from today up to it.
  const selIndex = React.useMemo(() => {
    if (!selected) return -1
    for (const [i, here] of byIndex) if (here.some((m) => m.key === selected)) return i
    return -1
  }, [byIndex, selected])
  // The whole sweep takes about half a second however far it runs.
  const step = selIndex > 0 ? Math.min(14, Math.max(1, 520 / selIndex)) : 0
  const card = !!onSelect

  // Every plain day is ONE path of circles, not a circle each: a year is ~370
  // days, and as elements they were most of the card's style recalculation on
  // open and of what the shared morph cloned (measured at 4×, Nov 2026).
  let plain = ""
  let todayDot: React.ReactNode = null
  const sweep: React.ReactNode[] = []
  const lit: React.ReactNode[] = []
  for (let i = 0; i < layout.days; i++) {
    const p = pos(i)
    const here = byIndex.get(i)
    if (i > 0 && i < selIndex) {
      sweep.push(<circle key={i} {...p} r={R} className="currency-sweep fill-primary" style={{ animationDelay: `${Math.round(i * step)}ms` }} />)
    }
    if (!here) {
      if (i === 0) todayDot = <circle {...p} r={R - 0.6} className="fill-none stroke-foreground" strokeWidth={1.2} />
      else plain += `M${p.cx - R} ${p.cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0`
      continue
    }
    const lead = (selected && here.find((m) => m.key === selected)) || here[0]
    const big = here.some((m) => m.key === closest)
    const isSel = selected !== null && here.some((m) => m.key === selected)
    const dim = selected !== null && !isSel
    // The card colours ONE dot, the selected; the tile colours by state.
    const fill = card ? (isSel ? (lead.state === "ok" ? "fill-primary" : STATE_FILL[lead.state]) : "fill-foreground/70") : STATE_FILL[lead.state]
    lit.push(
      <g key={i} className={cn("transition-opacity", dim && "opacity-25")}>
        {big && <circle {...p} r={R + 1.9} className="fill-none stroke-foreground" strokeWidth={1} />}
        <circle {...p} r={big || isSel ? R + 0.7 : R} className={fill} />
        {onSelect && (
          <circle
            {...p}
            r={PITCH * 0.9}
            className="cursor-pointer fill-transparent"
            onClick={(e) => {
              e.stopPropagation()
              // A tap selects; on the selected day a second tap steps to the
              // next currency on it, and on the last deselects.
              const at = here.findIndex((m) => m.key === selected)
              onSelect(at < 0 ? here[0].key : (here[at + 1]?.key ?? null))
            }}
          >
            <title>{here.map((m) => m.name).join(", ")}</title>
          </circle>
        )}
      </g>,
    )
  }

  return (
    <div className={cn("relative", className)} onClick={onSelect ? () => onSelect(null) : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Currency expiries, the next ${ahead === "1y" ? "year" : ahead === "6m" ? "six months" : "90 days"}`}>
        <path d={plain} className="fill-foreground/[0.13]" />
        {todayDot}
        {/* Keyed on the selection, so each one replays the sweep. */}
        <g key={selected ?? ""}>{sweep}</g>
        {lit}
      </svg>
      <div aria-hidden className="relative mt-0.5 h-3 text-[9px] leading-3 text-muted-foreground">
        {layout.months.map((m, i) => {
          // A month label where it has room: not over the one before it.
          const prev = layout.months[i - 1]
          if (prev && m.week - prev.week < 3) return null
          if (m.week > layout.weeks - 2) return null
          return (
            <span key={m.week} className="absolute" style={{ left: `${(m.week / layout.weeks) * 100}%` }}>
              {m.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
