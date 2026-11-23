/**
 * Whether an ALTERNATE's forecast makes it a poor one for THIS flight (the
 * owner, Nov 2026: "what's more important is to highlight if there is
 * inclement weather during period, i.e. any tempo TS, RA or low vis that
 * makes it unsuitable for an alternate or a divert during that period").
 *
 * Every TAF period that touches the time the flight could arrive there (the
 * destination's arrival plus the diversion, ± an hour) is read for what IT
 * brings — a TEMPO or PROB group's own words, a base or FM group's whole
 * conditions — and named the way the TAF names it: thunderstorms, rain
 * (light rain is not named), snow, fog, freezing precipitation, squalls,
 * CB; visibility under 5 km and a ceiling under 1,000 ft. A forecast below
 * the alternate's OWN minima (the OFP's "200FT/550M") is UNSUITABLE; anything
 * else named is a CAUTION. Pure.
 */

import { ceilingFt, type Conditions, type ParsedTaf } from "@/lib/weather/brief"

export interface AlternateConcern {
  /** "TEMPO", "PROB30", "BECMG", "FM" or "" for the base forecast. */
  tag: string
  /** What it brings, as the TAF writes it ("TSRA", "CB", "Vis 1500m", "Ceiling 600ft"). */
  words: string[]
  fromMs: number
  toMs: number
  severity: "caution" | "unsuitable"
}

const CAUTION_VIS_M = 5000
const CAUTION_CEILING_FT = 1000

/** "200FT/550M" → its decision height and visibility; either may be missing. */
export function parseMinima(text: string): { ft: number | null; m: number | null } {
  const ft = text.match(/(\d{2,4})\s*FT/i)
  const m = text.match(/(\d{3,4})\s*M\b/i)
  return { ft: ft ? Number(ft[1]) : null, m: m ? Number(m[1]) : null }
}

function weatherWords(c: Conditions): string[] {
  return (c.weather ?? []).filter((w) => {
    if (/^-/.test(w) && !/TS|FZ/.test(w)) return false // light rain or drizzle is no reason
    return /TS|RA|SN|SG|FZ|SQ|FC|VA|GR|GS|PL|DS|SS/.test(w) || (/FG/.test(w) && !/^(MI|BC|PR|VC)FG$/.test(w))
  })
}

export function alternateConcerns(taf: ParsedTaf, fromMs: number, toMs: number, minima: string): AlternateConcern[] {
  const min = parseMinima(minima)
  const out: AlternateConcern[] = []
  for (const p of taf.periods) {
    if (p.to <= fromMs || p.from >= toMs) continue
    const change = p.kind === "TEMPO" || p.kind === "PROB" || p.kind === "BECMG"
    const own = change ? p.stated : p.conditions
    const words = weatherWords(own)
    if ((own.clouds ?? []).some((l) => l.type === "CB") && !words.some((w) => /TS/.test(w))) words.push("CB")
    let unsuitable = false
    if (own.visM !== undefined && own.visM < CAUTION_VIS_M) {
      words.push(`Vis ${own.visM}m`)
      if (min.m !== null && own.visM < min.m) unsuitable = true
    }
    const ceil = own.clouds ? ceilingFt(own) : null
    if (ceil !== null && ceil < CAUTION_CEILING_FT) {
      words.push(`Ceiling ${ceil}ft`)
      if (min.ft !== null && ceil < min.ft) unsuitable = true
    }
    if (words.length === 0) continue
    const tag = p.kind === "PROB" ? `PROB${p.prob ?? ""}${p.tempo ? " TEMPO" : ""}` : p.kind === "base" ? "" : p.kind
    out.push({ tag, words, fromMs: Math.max(p.from, fromMs), toMs: Math.min(p.to, toMs), severity: unsuitable ? "unsuitable" : "caution" })
  }
  return out
}
