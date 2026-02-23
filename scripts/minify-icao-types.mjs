#!/usr/bin/env node

/**
 * Minify & deduplicate ICAOtypes.json
 *
 * Input:  public/ICAOtypes.json  (7,246 records, verbose keys, duplicate designators)
 * Output: public/icao-types.min.json (2,607 unique designators, compact keys)
 *
 * Deduplication strategy:
 * - Group by Designator
 * - For each group, prefer the entry with a non-null WTG
 * - If all have the same WTG (or null), take the first entry
 *
 * Compact format: { d, m, t, w, g }
 *   d = Designator (ICAO type code)
 *   m = ManufacturerCode
 *   t = Description (3-char ICAO code like "L2J")
 *   w = WTC (Wake Turbulence Category)
 *   g = WTG (Wake Turbulence Group)
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const inputPath = join(__dirname, "..", "public", "ICAOtypes.json")
const outputPath = join(__dirname, "..", "public", "icao-types.min.json")

const raw = JSON.parse(readFileSync(inputPath, "utf-8"))
console.log(`Read ${raw.length} records from ICAOtypes.json`)

// Group by designator
const byDesignator = new Map()
for (const item of raw) {
  const d = item.Designator
  if (!byDesignator.has(d)) {
    byDesignator.set(d, [])
  }
  byDesignator.get(d).push(item)
}

console.log(`Found ${byDesignator.size} unique designators`)

// Deduplicate: prefer entry with non-null WTG, else first
const deduped = []
for (const [designator, items] of byDesignator) {
  // Prefer an entry with a non-null WTG
  const withWTG = items.find((i) => i.WTG != null)
  const pick = withWTG || items[0]

  deduped.push({
    d: pick.Designator,
    m: pick.ManufacturerCode,
    t: pick.Description,
    w: pick.WTC,
    g: pick.WTG || "",
  })
}

// Sort by designator for consistent output
deduped.sort((a, b) => a.d.localeCompare(b.d))

const json = JSON.stringify(deduped)
writeFileSync(outputPath, json, "utf-8")

const sizeKB = (Buffer.byteLength(json, "utf-8") / 1024).toFixed(1)
console.log(`Wrote ${deduped.length} records to icao-types.min.json (${sizeKB} KB)`)
