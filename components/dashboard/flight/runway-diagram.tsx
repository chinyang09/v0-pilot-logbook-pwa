"use client"

/**
 * An airport's RUNWAYS as a picture, inside a wind dial — the Airport tile
 * and its card draw the same one (the owner, Nov 2026: "show runways and
 * runway in use … along with wind direction").
 *
 * - The runways to scale and north up, off their real thresholds
 *   (`lib/runways/`): the one the traffic is LANDING on in the accent with an
 *   arrowhead coming in over its threshold, the one it is DEPARTING from in
 *   ink with an arrowhead leaving past its far end, the rest muted. With
 *   nothing from the traffic, the wind's favoured runway carries the landing
 *   arrow, muted. Without thresholds, the one runway shown is drawn through
 *   the middle on its heading.
 * - The wind on the rim: a ring of dots and a wedge where it comes FROM,
 *   amber from 25kt or a gust (the dial the tile had).
 *
 * Pure SVG on plain numbers; nothing measured.
 */

import * as React from "react"
import type { RunwayGeo } from "@/lib/runways/parse"
import { cn } from "@/lib/utils"

interface Props {
  geometry: readonly RunwayGeo[] | null | undefined
  /** Without geometry: the heading of the runway shown, and its ident. */
  fallback?: { ident: string; headingDeg: number } | null
  landing: string | null
  departing: string | null
  /** The wind's runway, drawn when the traffic says nothing. */
  favoured: string | null
  windDir: number | null | undefined
  windKt: number | undefined
  gust?: number
  size: number
  /** The shared morph's key. */
  morph?: string
  className?: string
}

interface Line {
  ends: [string, string]
  a: readonly [number, number]
  b: readonly [number, number]
}

export function RunwayDiagram({ geometry, fallback, landing, departing, favoured, windDir, windKt, gust, size, morph, className }: Props) {
  const c = size / 2
  const ringR = c - 3
  const inner = ringR - Math.max(9, size * 0.12)
  const at = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180
    return [c + r * Math.sin(rad), c - r * Math.cos(rad)] as const
  }

  // Every placed runway, in nm east / north of their middle, scaled to fit the ring.
  const lines = React.useMemo<Line[] | null>(() => {
    const placed = (geometry ?? []).flatMap((r) => {
      const [p, q] = r.ends
      return p && q && p.lat !== null && p.lon !== null && q.lat !== null && q.lon !== null
        ? [{ ends: [p.ident, q.ident] as [string, string], pts: [[p.lon, p.lat], [q.lon, q.lat]] as const }]
        : []
    })
    if (placed.length === 0) return null
    const lat0 = placed.reduce((s, p) => s + p.pts[0][1] + p.pts[1][1], 0) / (placed.length * 2)
    const lon0 = placed.reduce((s, p) => s + p.pts[0][0] + p.pts[1][0], 0) / (placed.length * 2)
    const k = Math.cos((lat0 * Math.PI) / 180)
    const xy = placed.map((p) => ({ ends: p.ends, pts: p.pts.map(([lon, lat]) => [(lon - lon0) * 60 * k, (lat - lat0) * 60] as const) }))
    // Scaled by the farthest end from the middle, so the layout fits a circle.
    const span = Math.max(0.4, ...xy.flatMap((p) => p.pts.map(([x, y]) => Math.hypot(x, y))))
    // Room left inside the ring for the approach and departure arrows.
    const s = (inner * 0.72) / span
    return xy.map((p) => ({
      ends: p.ends,
      a: [c + p.pts[0][0] * s, c - p.pts[0][1] * s] as const,
      b: [c + p.pts[1][0] * s, c - p.pts[1][1] * s] as const,
    }))
  }, [geometry, inner, c])

  const drawn: Line[] =
    lines ??
    (fallback
      ? [{ ends: [fallback.ident, ""], a: at(fallback.headingDeg + 180, inner * 0.6), b: at(fallback.headingDeg, inner * 0.6) }]
      : [])

  const arrowAt = (ident: string | null) => {
    if (!ident) return null
    const l = drawn.find((x) => x.ends.includes(ident))
    if (!l) return null
    // The end named is where an aeroplane lands (its threshold) or starts its roll.
    const [from, to] = l.ends[0] === ident ? [l.a, l.b] : [l.b, l.a]
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const len = Math.hypot(dx, dy) || 1
    return { from, to, ux: dx / len, uy: dy / len, line: l }
  }
  const land = arrowAt(landing ?? favoured)
  const dep = arrowAt(departing)
  const tri = (x: number, y: number, ux: number, uy: number, s: number) => {
    // A triangle pointing along (ux, uy), its tip at (x, y).
    const bx = x - ux * s
    const by = y - uy * s
    return `${x},${y} ${bx - uy * s * 0.5},${by + ux * s * 0.5} ${bx + uy * s * 0.5},${by - ux * s * 0.5}`
  }
  const head = Math.max(4, size * 0.06)
  const stroke = Math.max(3, size * 0.045)
  const tone = (l: Line) =>
    land && l === land.line ? (landing ? "text-primary" : "text-foreground/70") : dep && l === dep.line ? "text-foreground" : "text-muted-foreground/45"

  const strong = (windKt ?? 0) >= 25 || (gust ?? 0) > 0
  const wedge =
    windDir !== null && windDir !== undefined && windKt
      ? (() => {
          const [ox1, oy1] = at(windDir - 14, ringR + 1)
          const [ox2, oy2] = at(windDir + 14, ringR + 1)
          const [ix, iy] = at(windDir, ringR - Math.max(8, size * 0.11))
          return `M ${ox1} ${oy1} A ${ringR + 1} ${ringR + 1} 0 0 1 ${ox2} ${oy2} L ${ix} ${iy} Z`
        })()
      : null

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("shrink-0", className)} aria-hidden data-morph={morph}>
      {Array.from({ length: 24 }, (_, i) => {
        const [x, y] = at(i * 15, ringR - 1)
        return <circle key={i} cx={x} cy={y} r={Math.max(0.9, size * 0.012)} className="fill-muted-foreground/50" />
      })}
      {drawn.map((l) => (
        <line
          key={l.ends.join()}
          x1={l.a[0]}
          y1={l.a[1]}
          x2={l.b[0]}
          y2={l.b[1]}
          stroke="currentColor"
          className={tone(l)}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      ))}
      {/* Landing: the approach, dashed, comes in over the threshold to an
          arrowhead clear of the runway's round cap (under it, the tip hid
          and the arrow read backwards). */}
      {land &&
        (() => {
          const gap = stroke * 0.5 + 2
          const tip = [land.from[0] - land.ux * gap, land.from[1] - land.uy * gap] as const
          const len = head * 1.3
          const far = Math.max(len * 2.2, inner * 0.26)
          const cls = landing ? "text-primary" : "text-foreground/70"
          return (
            <g className={cls}>
              <line
                x1={tip[0] - land.ux * far}
                y1={tip[1] - land.uy * far}
                x2={tip[0] - land.ux * len}
                y2={tip[1] - land.uy * len}
                stroke="currentColor"
                strokeWidth={Math.max(1.2, stroke * 0.35)}
                strokeDasharray={`${Math.max(1.5, stroke * 0.5)} ${Math.max(1.5, stroke * 0.5)}`}
                strokeLinecap="round"
              />
              <polygon points={tri(tip[0], tip[1], land.ux, land.uy, len)} fill="currentColor" />
            </g>
          )
        })()}
      {/* Departing: the arrow leaves past the far end. */}
      {dep && (
        <polygon
          points={tri(dep.to[0] + dep.ux * (stroke * 0.5 + 2 + head * 1.3), dep.to[1] + dep.uy * (stroke * 0.5 + 2 + head * 1.3), dep.ux, dep.uy, head * 1.3)}
          className="fill-foreground"
        />
      )}
      {wedge && <path d={wedge} className={strong ? "fill-status-warning" : "fill-foreground/70"} />}
    </svg>
  )
}

/** The wind in words beside the diagram: "220° 15kt G25", "Calm", "VRB 3kt". */
export function windWords(dir: number | null | undefined, kt: number | undefined): string | null {
  if (kt === undefined) return null
  if (kt === 0) return "Calm"
  return `${dir === null || dir === undefined ? "VRB" : `${String(dir).padStart(3, "0")}°`} ${kt}kt`
}
