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
