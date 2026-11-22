/**
 * How a raw report is read on a phone. Pure.
 */

/** A TAF broken before each change group, so every period starts a line — the way a briefing prints it. */
export function tafLines(raw: string): string[] {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .split(/ (?=(?:TEMPO|BECMG|FM\d{6}|PROB\d{2})\b)/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** "25m ago", "3h ago" — how old an observation is. */
export function ageText(atMs: number, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - atMs) / 60_000))
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h}h ${min % 60}m ago` : `${Math.floor(h / 24)}d ago`
}

/**
 * A cloud layer as the METAR writes it (the owner, Nov 2026: "follow the
 * metar reading eg. BKN300 or SCT008"): the cover and its base in hundreds of
 * feet, three digits — 30,000ft BKN is "BKN300", 800ft SCT is "SCT008".
 */
export function cloudLayer(cover: string, ft: number): string {
  return `${cover}${String(Math.max(0, Math.round(ft / 100))).padStart(3, "0")}`
}
