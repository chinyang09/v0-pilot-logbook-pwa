"use client"

/**
 * The currency DOT CALENDAR (the owner, Nov 2026): a dot a day, a week to a
 * column, looking ahead from today (`currency-dots.ts` lays it out) — and each
 * currency's expiry one dot lit on it.
 *
 * | | On the tile | In the card |
 * |---|---|---|
 * | an expiry | ink, amber or red by its state — dark cockpit: nothing nominal is coloured | its own colour (the first three in date order; the rest ink) |
 * | the closest | larger, ringed | larger, ringed |
 * | a tap | opens the card | selects that currency: the others dim |
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

/**
 * Identity colours for the card — the reference palette's first three slots,
 * the only three that stay apart for every reader when all of them are on
 * screen at once (validated, light and dark); anything past them is ink, and
 * a tap isolates it.
 */
export const SERIES = [
  { fill: "fill-[#2a78d6] dark:fill-[#3987e5]", bg: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  { fill: "fill-[#eb6834] dark:fill-[#d95926]", bg: "bg-[#eb6834] dark:bg-[#d95926]" },
  { fill: "fill-[#1baf7a] dark:fill-[#199e70]", bg: "bg-[#1baf7a] dark:bg-[#199e70]" },
] as const
export const OTHER = { fill: "fill-foreground/70", bg: "bg-foreground/70" }

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
  colorOf,
  selected = null,
  onSelect,
  className,
}: {
  today: string
  ahead: LookAhead
  marks: DotMark[]
  /** The mark to ring: the soonest. */
  closest: string | null
  /** The card's identity colour for a mark; on the tile, its state's colour. */
  colorOf?: (key: string) => string
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

  const days: React.ReactNode[] = []
  const lit: React.ReactNode[] = []
  for (let i = 0; i < layout.days; i++) {
    const p = pos(i)
    const here = byIndex.get(i)
    if (!here) {
      days.push(
        i === 0 ? (
          <circle key={i} {...p} r={R - 0.6} className="fill-none stroke-foreground" strokeWidth={1.2} />
        ) : (
          <circle key={i} {...p} r={R} className="fill-foreground/[0.13]" />
        ),
      )
      continue
    }
    const lead = (selected && here.find((m) => m.key === selected)) || here[0]
    const big = here.some((m) => m.key === closest)
    const dim = selected !== null && !here.some((m) => m.key === selected)
    lit.push(
      <g key={i} className={cn("transition-opacity", dim && "opacity-25")}>
        {big && <circle {...p} r={R + 1.9} className="fill-none stroke-foreground" strokeWidth={1} />}
        <circle {...p} r={big ? R + 0.7 : R} className={colorOf ? colorOf(lead.key) : STATE_FILL[lead.state]} />
        {onSelect && (
          <circle
            {...p}
            r={PITCH * 0.9}
            className="cursor-pointer fill-transparent"
            onClick={(e) => {
              e.stopPropagation()
              // A second tap on the same day steps to the next currency on it; on the last, clears.
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
        {days}
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
