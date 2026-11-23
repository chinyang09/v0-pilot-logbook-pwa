"use client"

/**
 * What a TALL wide tile says under its face (the owner, Nov 2026: on a
 * desktop "the widget [should] be more reactive … else widgets will end up
 * very huge wasting good space that can provide information"): the next rows
 * its card holds, as many as FIT the height the grid gives the tile, never a
 * row cut in half.
 *
 * The rows take no height of their own — they are laid out in a box over the
 * room left under the face (`absolute inset-0`) — so a tile is as tall as its
 * face, the grid shares the page's height out among its rows, and whatever
 * that leaves is filled. Every row is laid out; those past the foot are
 * `invisible`, read off a ResizeObserver (after layout, never in a commit),
 * so showing fewer never moves the ones that stay.
 */

import * as React from "react"
import { cn } from "@/lib/utils"

export interface TileRow {
  key: string
  label: string
  value: React.ReactNode
  /** A smaller line beside the value. */
  sub?: string
  tone?: "caution" | "fail"
  /** Shared-morph keys: what flies between the tile and its card. */
  labelMorph?: string
  valueMorph?: string
}

export function TileRows({
  rows,
  className,
  caption,
  names = false,
}: {
  rows: TileRow[]
  className?: string
  caption?: string
  /** The labels ARE the content (the currencies' names), not captions. */
  names?: boolean
}) {
  const box = React.useRef<HTMLDivElement>(null)
  const [fit, setFit] = React.useState(0)
  React.useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const h = el.clientHeight
      let n = 0
      for (const c of Array.from(el.children) as HTMLElement[]) {
        if (c.dataset.caption !== undefined) continue
        if (c.offsetTop + c.offsetHeight > h + 0.5) break
        n++
      }
      setFit((prev) => (prev === n ? prev : n))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rows.length])
  if (rows.length === 0) return null
  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div ref={box} className="absolute inset-0 overflow-hidden">
        {/* A caption only over rows that are shown. */}
        {caption && (
          <p data-caption="" className={cn("pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground", fit === 0 && "invisible")}>
            {caption}
          </p>
        )}
        {rows.map((r, i) => (
          <div
            key={r.key}
            className={cn(
              "flex items-baseline justify-between gap-3 border-t border-border/50 py-1.5 text-[12px] leading-tight",
              !caption && i === 0 && "mt-2",
              i >= fit && "invisible",
            )}
          >
            <span className={cn("min-w-0 truncate", names ? "text-foreground" : "text-muted-foreground")} data-morph={i < fit ? r.labelMorph : undefined}>{r.label}</span>
            <span className="shrink-0 text-right tabular-nums" suppressHydrationWarning>
              {r.sub && <span className="text-muted-foreground">{r.sub} · </span>}
              <span data-morph={i < fit ? r.valueMorph : undefined} className={cn("font-semibold", r.tone === "fail" ? "text-destructive" : r.tone === "caution" ? "text-status-warning" : "text-foreground")}>
                {r.value}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
