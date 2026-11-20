/**
 * Which runway the wind favours, and what it gives on it — the airport
 * panel's picture (the owner, Nov 2026: "picture tells a thousand words").
 *
 * A runway end's heading is its TRUE heading where the airport data gives one
 * (`runwayEndsFrom`, aviationweather.gov's `alignment`) — the frame a METAR's
 * wind is in, so the components are exact. Without it the designator stands
 * in ("02L" points 020°): the MAGNETIC heading rounded to ten degrees, a few
 * degrees out in most places. Either way it is a glance at which way the wind
 * sits, never a performance figure.
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

/**
 * Both ends of each runway, on the TRUE heading the airport data gives the
 * first end ("02L/20R" at 23° → 02L 23°, 20R 203°); a runway with none falls
 * back to its designator.
 */
export function runwayEndsFrom(runways: readonly { id: string; trueHeading: number | null }[]): RunwayEnd[] {
  const out: RunwayEnd[] = []
  const seen = new Set<string>()
  for (const r of runways) {
    const ends = runwayEnds([r.id])
    ends.forEach((e, i) => {
      if (seen.has(e.ident)) return
      seen.add(e.ident)
      out.push(r.trueHeading === null ? e : { ident: e.ident, headingDeg: (r.trueHeading + i * 180) % 360 })
    })
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
