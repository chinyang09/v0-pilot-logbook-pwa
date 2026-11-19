/**
 * Which runway the wind favours, and what it gives on it — the airport
 * panel's picture (the owner, Nov 2026: "picture tells a thousand words").
 *
 * A runway end is read off its designator: "02L" points 020°. That is the
 * MAGNETIC heading rounded to ten degrees, while a METAR's wind is TRUE; the
 * difference is the local variation (near zero across South-East Asia, a few
 * degrees in most places). It is an approximation and is said as one — a
 * glance at which way the wind sits, never a performance figure.
 *
 * Pure, so it is tested without the page.
 */

export interface RunwayEnd {
  /** "02L" */
  ident: string
  /** Degrees, from the designator. */
  headingDeg: number
}

export interface WindOnRunway {
  end: RunwayEnd
  /** Positive is a headwind, negative a tailwind, kt. */
  headKt: number
  /** Always positive, kt. */
  crossKt: number
  /** The side the crosswind comes FROM, seen down the runway. */
  crossFrom: "L" | "R" | null
}

const END = /^(\d{1,2})([LCR]?)$/

/** "02L/20R" → both ends; a single designator ("05") → that end alone. */
export function runwayEnds(names: readonly string[]): RunwayEnd[] {
  const out: RunwayEnd[] = []
  const seen = new Set<string>()
  for (const name of names) {
    for (const raw of String(name).toUpperCase().split(/[/\-\s]+/)) {
      const m = END.exec(raw.trim())
      if (!m) continue
      const num = Number(m[1])
      if (num < 1 || num > 36) continue
      const ident = `${String(num).padStart(2, "0")}${m[2]}`
      if (seen.has(ident)) continue
      seen.add(ident)
      out.push({ ident, headingDeg: num * 10 })
    }
  }
  return out
}

/** The runway names out of the lookup's raw runway records (`{ name: "02L/20R", … }`). */
export function runwayNamesFrom(raw: readonly unknown[] | null | undefined): string[] {
  const out: string[] = []
  for (const r of raw ?? []) {
    if (typeof r === "string") out.push(r)
    else if (r && typeof r === "object") {
      const name = (r as { name?: unknown; ident?: unknown }).name ?? (r as { ident?: unknown }).ident
      if (typeof name === "string" && name.trim()) out.push(name.trim())
    }
  }
  return out
}

/** The wind's head and cross components on one runway end. */
export function windOn(end: RunwayEnd, windDir: number, windKt: number): WindOnRunway {
  // The angle from the runway's heading to where the wind comes FROM.
  const diff = (((windDir - end.headingDeg) % 360) + 540) % 360 - 180
  const rad = (diff * Math.PI) / 180
  const head = Math.round(windKt * Math.cos(rad))
  const cross = Math.round(windKt * Math.sin(rad))
  return {
    end,
    headKt: head === 0 ? 0 : head,
    crossKt: Math.abs(cross),
    crossFrom: cross === 0 ? null : cross > 0 ? "R" : "L",
  }
}

/**
 * The end the wind favours: the most headwind, then the least crosswind. Null
 * when there is nothing to choose with — no runways, or a calm or variable wind.
 */
export function favouredRunway(
  ends: readonly RunwayEnd[],
  windDir: number | null | undefined,
  windKt: number | undefined,
): WindOnRunway | null {
  if (ends.length === 0 || windDir === null || windDir === undefined || !windKt) return null
  let best: WindOnRunway | null = null
  for (const end of ends) {
    const w = windOn(end, windDir, windKt)
    if (!best || w.headKt > best.headKt || (w.headKt === best.headKt && w.crossKt < best.crossKt)) best = w
  }
  return best
}
