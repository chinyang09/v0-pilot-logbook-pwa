/**
 * The world's airlines (name, IATA, ICAO), for naming a crew card's company
 * in one standard spelling and for knowing which airline the pilot flies.
 *
 * Fetched through the lookup door (`lookup.airlines`, ~2,850 rows, ~145KB)
 * the first time something needs it, and kept on the device for 30 days —
 * the list changes slowly, and a stale copy is far better than none offline.
 * A failed fetch answers the stale copy, or nothing; it never throws.
 */

import type { Fr24Airline } from "@/lib/fr24/types"

const STORAGE_KEY = "oooi-airlines-v1"
const MAX_AGE_MS = 30 * 86_400_000

let memory: Fr24Airline[] | null = null
let inFlight: Promise<Fr24Airline[]> | null = null

function readStored(): { at: number; rows: Fr24Airline[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.rows) && typeof parsed.at === "number" ? parsed : null
  } catch {
    return null
  }
}

/** Every airline: memory, then the device's copy, then the network. */
export function loadAirlines(nowMs = Date.now()): Promise<Fr24Airline[]> {
  if (memory) return Promise.resolve(memory)
  if (inFlight) return inFlight
  inFlight = (async () => {
    const stored = readStored()
    if (stored && nowMs - stored.at < MAX_AGE_MS) return (memory = stored.rows)
    try {
      const { lookup } = await import("@/lib/lookup/client")
      const answer = await lookup.airlines()
      if (answer.ok && Array.isArray(answer.data) && answer.data.length) {
        const rows = (answer.data as Fr24Airline[]).filter((a) => a && a.name)
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: nowMs, rows }))
        } catch {
          // Storage full or blocked: the memory copy still serves this session.
        }
        return (memory = rows)
      }
    } catch {
      // Offline or the door refused: fall through to the stale copy.
    }
    // Nothing fetched: answer the stale copy, but do not hold an EMPTY answer
    // in memory, or a session that started offline never gets the list.
    if (stored?.rows.length) return (memory = stored.rows)
    return []
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/**
 * The airline a text names, exactly: its IATA or ICAO designator, or its name
 * spelt any way (case and punctuation aside). Null when it names none, or
 * names a designator two airlines share.
 */
export function resolveAirline(rows: readonly Fr24Airline[], text: string | null | undefined): Fr24Airline | null {
  const t = (text || "").trim()
  if (!t) return null
  const upper = t.toUpperCase()
  if (/^[A-Z0-9]{2}$/.test(upper)) {
    const hits = rows.filter((a) => a.iata === upper)
    if (hits.length === 1) return hits[0]
  }
  if (/^[A-Z]{3}$/.test(upper)) {
    const hit = rows.find((a) => a.icao === upper)
    if (hit) return hit
  }
  const key = fold(t)
  return key ? rows.find((a) => fold(a.name) === key) ?? null : null
}

/**
 * The airlines a partial text could be, best first: a designator it is, then
 * names it begins, then names it is inside. Airlines without an IATA code
 * (mostly charter and cargo) rank after those with one at the same level.
 */
export function matchAirlines(rows: readonly Fr24Airline[], text: string, limit = 6): Fr24Airline[] {
  const t = text.trim()
  if (t.length < 2) return []
  const upper = t.toUpperCase()
  const key = fold(t)
  const scored: { a: Fr24Airline; score: number }[] = []
  for (const a of rows) {
    const name = fold(a.name)
    let score = -1
    if (a.iata === upper || a.icao === upper) score = 0
    else if (name.startsWith(key)) score = 1
    else if (key.length >= 3 && name.includes(key)) score = 2
    if (score >= 0) scored.push({ a, score: score * 2 + (a.iata ? 0 : 1) })
  }
  return scored
    .sort((x, y) => x.score - y.score || x.a.name.localeCompare(y.a.name))
    .slice(0, limit)
    .map((s) => s.a)
}
