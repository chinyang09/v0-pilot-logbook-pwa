/**
 * Server-side ICAO DOC 8643 type lookup
 *
 * Loads icao-types.min.json once into memory for O(1) designator lookups.
 * Used by API routes to hydrate aircraft submissions with type data.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

interface ICAOTypeEntry {
  d: string // designator
  m: string // manufacturerCode
  t: string // description (3-char ICAO code)
  w: string // WTC
  g: string // WTG
}

export interface ICAOTypeInfo {
  description: string // e.g. "L2J"
  wtc: string // e.g. "M"
  wtg: string // e.g. "D"
  manufacturerCode: string // e.g. "AIRBUS"
}

let typeMap: Map<string, ICAOTypeInfo> | null = null

function ensureLoaded(): Map<string, ICAOTypeInfo> {
  if (typeMap) return typeMap

  const filePath = join(process.cwd(), "public", "icao-types.min.json")
  const raw: ICAOTypeEntry[] = JSON.parse(readFileSync(filePath, "utf-8"))

  typeMap = new Map()
  for (const entry of raw) {
    typeMap.set(entry.d.toUpperCase(), {
      description: entry.t,
      wtc: entry.w,
      wtg: entry.g || "",
      manufacturerCode: entry.m,
    })
  }

  console.log(`[ICAO Types Server] Loaded ${typeMap.size} type designators`)
  return typeMap
}

/**
 * Look up ICAO type info by designator code
 */
export function getICAOTypeByDesignator(typecode: string): ICAOTypeInfo | null {
  if (!typecode) return null
  const map = ensureLoaded()
  return map.get(typecode.toUpperCase().trim()) || null
}
