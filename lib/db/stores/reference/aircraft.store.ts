/**
 * Aircraft reference store operations
 *
 * Manages aircraft reference data in IndexedDB (synced from MongoDB).
 * No CDN download — aircraft are discovered via FR24 search and synced
 * from MongoDB's shared enriched pool.
 */

import { referenceDb } from "../../reference-db"
import type { AircraftReference, AircraftRecord } from "@/types/entities/aircraft.types"

// ============================================
// Types
// ============================================

export interface NormalizedAircraft {
  registration: string
  icao24: string
  typecode: string
  shortDescription: string
  wtc: string
  wtg: string
  manufacturerCode: string
  operator: string
}

// ============================================
// Helpers
// ============================================

function normalizeForSearch(str: string): string {
  return str.toUpperCase().replace(/-/g, "")
}

export function normalizeAircraft(data: {
  reg?: string | null
  registration?: string
  icao24?: string | null
  icaotype?: string | null
  typecode?: string
  short_type?: string | null
  shortDescription?: string
  wtc?: string
  wtg?: string
  manufacturerCode?: string
  operator?: string
}): NormalizedAircraft {
  return {
    registration: data.registration || data.reg || "",
    icao24: data.icao24 || "",
    typecode: data.typecode || data.icaotype || "",
    shortDescription: data.shortDescription || data.short_type || "",
    wtc: data.wtc || "",
    wtg: data.wtg || "",
    manufacturerCode: data.manufacturerCode || "",
    operator: data.operator || "",
  }
}

export function formatAircraft(aircraft: NormalizedAircraft): string {
  const parts = [aircraft.registration]
  if (aircraft.typecode) parts.push(`(${aircraft.typecode})`)
  return parts.join(" ")
}

function parseRecordData(record: AircraftReference): NormalizedAircraft | null {
  try {
    const data = JSON.parse(record.data)
    return normalizeAircraft(data)
  } catch {
    return null
  }
}

// ============================================
// Public API - Search
// ============================================

/**
 * Search aircraft from local IndexedDB
 */
export async function searchAircraftFromDB(
  query: string,
  limit = 50
): Promise<NormalizedAircraft[]> {
  if (!query || query.length < 2) return []

  const q = query.toUpperCase().trim()
  const qNormalized = normalizeForSearch(q)

  const matches: Array<{ aircraft: NormalizedAircraft; score: number }> = []

  await referenceDb.aircraftDatabase
    .each((record) => {
      const ac = parseRecordData(record)
      if (!ac) return

      let score = 0
      const reg = ac.registration.toUpperCase()
      const regNormalized = normalizeForSearch(reg)
      const typecode = ac.typecode.toUpperCase()
      const icao24 = ac.icao24.toUpperCase()

      if (regNormalized && regNormalized === qNormalized) {
        score = 1000
      } else if (regNormalized && regNormalized.startsWith(qNormalized)) {
        score = 900
      } else if (regNormalized && regNormalized.includes(qNormalized)) {
        score = 800
      } else if (typecode === q) {
        score = 700
      } else if (typecode && typecode.startsWith(q)) {
        score = 600
      } else if (icao24 === q) {
        score = 550
      } else if (icao24 && icao24.startsWith(q)) {
        score = 500
      }

      if (score > 0) {
        matches.push({ aircraft: ac, score })
      }
    })

  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, limit).map((m) => m.aircraft)
}

/**
 * Get a single aircraft by registration from IndexedDB
 */
export async function getAircraftByRegistrationFromDB(
  registration: string
): Promise<NormalizedAircraft | undefined> {
  const reg = registration.toUpperCase()
  const regNormalized = normalizeForSearch(reg)

  // Try exact key match first
  let record = await referenceDb.aircraftDatabase.get(reg)

  // Fallback: scan for normalized match
  if (!record) {
    record = await referenceDb.aircraftDatabase
      .filter((r) => {
        const ac = parseRecordData(r)
        if (!ac) return false
        return normalizeForSearch(ac.registration) === regNormalized
      })
      .first()
  }

  if (!record) return undefined
  return parseRecordData(record) || undefined
}

/**
 * Get a single aircraft by ICAO24 hex from IndexedDB
 */
export async function getAircraftByIcao24FromDB(
  icao24: string
): Promise<NormalizedAircraft | undefined> {
  const hex = icao24.toUpperCase()

  const record = await referenceDb.aircraftDatabase
    .filter((r) => {
      const ac = parseRecordData(r)
      return ac?.icao24?.toUpperCase() === hex
    })
    .first()

  if (!record) return undefined
  return parseRecordData(record) || undefined
}

// ============================================
// Batch Lookup
// ============================================

/**
 * Batch lookup multiple registrations at once
 * Returns a Map for O(1) lookup by the caller
 */
export async function batchGetAircraftByRegistrations(
  registrations: string[]
): Promise<Map<string, NormalizedAircraft>> {
  const results = new Map<string, NormalizedAircraft>()
  if (registrations.length === 0) return results

  const uniqueRegs = [...new Set(registrations.map((r) => r.toUpperCase()))]
  const normalizedSet = new Set(uniqueRegs.map((r) => normalizeForSearch(r)))
  const upperSet = new Set(uniqueRegs)
  const found = new Set<string>()

  await referenceDb.aircraftDatabase
    .until(() => found.size >= uniqueRegs.length)
    .each((record) => {
      const ac = parseRecordData(record)
      if (!ac || !ac.registration) return

      const regUpper = ac.registration.toUpperCase()
      const regNormalized = normalizeForSearch(ac.registration)

      if (normalizedSet.has(regNormalized) || upperSet.has(regUpper)) {
        for (const searchReg of uniqueRegs) {
          const searchNorm = normalizeForSearch(searchReg)
          if (searchNorm === regNormalized || searchReg === regUpper) {
            results.set(searchReg, ac)
            found.add(searchReg)
          }
        }
      }
    })

  return results
}

// ============================================
// Custom Aircraft Entry
// ============================================

/**
 * Add or update an aircraft in the reference database
 * Used when adding aircraft from FR24 search, manual entry, or MongoDB sync
 */
export async function addCustomAircraftToDatabase(
  record: AircraftRecord
): Promise<string> {
  const reg = record.registration.toUpperCase()
  const { createId } = await import("@/lib/auth/shared/cuid")
  const submissionId = record.submissionId || createId()

  const data = {
    registration: reg,
    icao24: record.icao24 || "",
    typecode: record.typecode || "",
    operator: record.operator || "",
    shortDescription: record.shortDescription || "",
    wtc: record.wtc || "",
    wtg: record.wtg || "",
    manufacturerCode: record.manufacturerCode || "",
    source: record.source || "custom",
    submissionId,
  }

  await referenceDb.aircraftDatabase.put({
    registration: reg,
    data: JSON.stringify(data),
  })

  return submissionId
}

// ============================================
// Bulk Upsert (for sync)
// ============================================

/**
 * Bulk upsert aircraft records from MongoDB sync
 */
export async function bulkUpsertAircraftReferences(
  records: AircraftRecord[]
): Promise<number> {
  if (records.length === 0) return 0

  const entries: AircraftReference[] = records.map((record) => ({
    registration: record.registration.toUpperCase(),
    data: JSON.stringify({
      registration: record.registration.toUpperCase(),
      icao24: record.icao24 || "",
      typecode: record.typecode || "",
      operator: record.operator || "",
      shortDescription: record.shortDescription || "",
      wtc: record.wtc || "",
      wtg: record.wtg || "",
      manufacturerCode: record.manufacturerCode || "",
      source: "fr24",
    }),
  }))

  await referenceDb.aircraftDatabase.bulkPut(entries)
  return entries.length
}

// ============================================
// Basic CRUD
// ============================================

export async function addAircraftToDatabase(
  registration: string,
  data: string
): Promise<void> {
  await referenceDb.aircraftDatabase.put({
    registration: registration.toUpperCase(),
    data,
  })
}

export async function getAircraftFromDatabase(
  registration: string
): Promise<AircraftReference | undefined> {
  return referenceDb.aircraftDatabase.get(registration.toUpperCase())
}

export async function deleteAircraftFromDatabase(
  registration: string
): Promise<boolean> {
  const aircraft = await referenceDb.aircraftDatabase.get(
    registration.toUpperCase()
  )
  if (!aircraft) return false

  await referenceDb.aircraftDatabase.delete(registration.toUpperCase())
  return true
}

export async function getAllAircraftFromDatabase(): Promise<AircraftReference[]> {
  return referenceDb.aircraftDatabase.toArray()
}

export async function hasAircraftInDatabase(
  registration: string
): Promise<boolean> {
  const aircraft = await referenceDb.aircraftDatabase.get(
    registration.toUpperCase()
  )
  return !!aircraft
}

/**
 * Clear all aircraft reference data
 */
export async function clearAircraftCache(): Promise<void> {
  await referenceDb.aircraftDatabase.clear()
}
