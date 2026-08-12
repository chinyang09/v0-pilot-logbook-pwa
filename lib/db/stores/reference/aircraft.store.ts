/**
 * Aircraft reference store operations
 *
 * Manages aircraft reference data in IndexedDB (synced from MongoDB).
 * No CDN download — aircraft are discovered via FR24 search and synced
 * from MongoDB's shared enriched pool.
 */

import { referenceDb } from "../../reference-db"
import { DELETED_RETENTION_MS, isWithinRetention } from "@/lib/utils/retention"
import { normalizeRegistration } from "@/lib/utils/string"
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

// Canonical registration key (strips all non-alphanumeric), shared with the
// server dedup key so local lookups never miss a record the server stored.
function normalizeForSearch(str: string): string {
  return normalizeRegistration(str)
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
  if (record && record.deletedAt != null) record = undefined

  // Fallback: scan for normalized match
  if (!record) {
    record = await referenceDb.aircraftDatabase
      .filter((r) => {
        if (r.deletedAt != null) return false
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
 * Pair each unmatched input registration with the stored primary key that
 * means the same tail.
 *
 * "The same tail" is the canonical `normalizeRegistration` key — uppercase,
 * alphanumerics only — so `9vnca`, `9V NCA` and `9VNCA` all resolve to a
 * record stored as `9V-NCA`. A `bulkGet` cannot do this: it matches the
 * primary key exactly, which covers "input has a dash, stored has none" and
 * not the reverse. The reverse is the common case for a migrated logbook.
 *
 * Pure, and separated from the Dexie call so the matching rule can be tested
 * without standing up IndexedDB.
 */
export function matchRegistrationKeys(
  storedKeys: readonly string[],
  inputs: readonly string[]
): Array<{ orig: string; key: string }> {
  const byNormalized = new Map<string, string>()
  for (const key of storedKeys) {
    const norm = normalizeForSearch(String(key))
    // First key wins, so a lookup is stable when a table somehow holds both
    // "9V-NCA" and "9VNCA".
    if (norm && !byNormalized.has(norm)) byNormalized.set(norm, String(key))
  }

  const resolvable: Array<{ orig: string; key: string }> = []
  for (const orig of inputs) {
    const key = byNormalized.get(normalizeForSearch(orig))
    if (key) resolvable.push({ orig, key })
  }
  return resolvable
}

/**
 * Batch lookup multiple registrations at once
 * Returns a Map for O(1) lookup by the caller
 */
export async function batchGetAircraftByRegistrations(
  registrations: string[]
): Promise<Map<string, NormalizedAircraft>> {
  const results = new Map<string, NormalizedAircraft>()
  if (registrations.length === 0) return results

  // Build forward + reverse lookup maps so we can return results keyed by the
  // caller's original casing/format.
  const uniqueRegs = [...new Set(registrations.map((r) => r.toUpperCase().trim()))]

  // The aircraftDatabase table is keyed by `registration` (its primary key,
  // always stored uppercased). Use bulkGet — an indexed lookup of every
  // requested registration in one round-trip — so we never have to scan the
  // 615k-record table.
  //
  // Registrations may be stored with or without dashes depending on source
  // (FR24 vs custom-entered). Look up both the original form AND a dashless
  // form for each input; the union covers both storage shapes.
  const lookupKeys: string[] = []
  const keyToOriginal = new Map<string, string>()
  for (const orig of uniqueRegs) {
    if (!keyToOriginal.has(orig)) {
      keyToOriginal.set(orig, orig)
      lookupKeys.push(orig)
    }
    const dashless = normalizeForSearch(orig)
    if (dashless !== orig && !keyToOriginal.has(dashless)) {
      keyToOriginal.set(dashless, orig)
      lookupKeys.push(dashless)
    }
  }

  let records: (AircraftReference | undefined)[]
  try {
    records = await referenceDb.aircraftDatabase.bulkGet(lookupKeys)
  } catch {
    // bulkGet should always be available, but fail safe so an unexpected
    // schema state doesn't blow up the whole import.
    return results
  }

  records.forEach((record, i) => {
    if (!record) return
    // A SOFT-DELETED entry must not answer a lookup. It is in Recently
    // Deleted, so treating it as a hit both hides it from the list forever and
    // stops the enrichment chain ever asking the network for it again — which
    // is what made a deleted aircraft impossible to re-import.
    if (record.deletedAt != null) return
    const ac = parseRecordData(record)
    if (!ac || !ac.registration) return
    const orig = keyToOriginal.get(lookupKeys[i])
    if (orig && !results.has(orig)) results.set(orig, ac)
  })

  // ---- Normalized fallback for whatever the key lookups missed ----
  //
  // `bulkGet` can only match the primary key as stored, so the two forms above
  // cover "input has a dash, stored does not". They cannot cover the reverse —
  // and that is the common case for a migrated logbook, where LogTen holds
  // "9VNCA" while the reference table is keyed "9V-NCA". Only the SINGLE
  // lookup had that fallback, so every bulk import silently missed.
  //
  // Resolved over the table's PRIMARY KEYS, which Dexie can walk off the index
  // without deserializing a single record blob — cheap enough to do once per
  // import, and only when something actually missed.
  const misses = uniqueRegs.filter((reg) => !results.has(reg))
  if (misses.length > 0) {
    try {
      const allKeys = (await referenceDb.aircraftDatabase
        .toCollection()
        .primaryKeys()) as string[]
      const resolvable = matchRegistrationKeys(allKeys, misses)

      if (resolvable.length > 0) {
        const found = await referenceDb.aircraftDatabase.bulkGet(
          resolvable.map((r) => r.key)
        )
        found.forEach((record, i) => {
          if (!record || record.deletedAt != null) return
          const ac = parseRecordData(record)
          if (!ac || !ac.registration) return
          results.set(resolvable[i].orig, ac)
        })
      }
    } catch {
      // The fallback is an enhancement — a failure here just means those
      // registrations go on to the server/FR24 legs of the chain.
    }
  }

  return results
}

// ============================================
// Custom Aircraft Entry
// ============================================

/** Serialize an aircraft record into the stored JSON blob (single source of truth). */
function buildAircraftData(
  record: AircraftRecord,
  source: string,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({
    registration: record.registration.toUpperCase(),
    icao24: record.icao24 || "",
    typecode: record.typecode || "",
    operator: record.operator || "",
    shortDescription: record.shortDescription || "",
    wtc: record.wtc || "",
    wtg: record.wtg || "",
    manufacturerCode: record.manufacturerCode || "",
    source,
    ...extra,
  })
}

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

  await referenceDb.aircraftDatabase.put({
    registration: reg,
    data: buildAircraftData(record, record.source || "custom", { submissionId }),
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
    data: buildAircraftData(record, "fr24"),
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

/**
 * SOFT delete — the entry goes to Recently Deleted for 30 days.
 *
 * Local only, because `referenceDb` has no sync queue; deleting a custom
 * aircraft has always been a local act. What changes is that it is now
 * recoverable rather than destroyed on the tap.
 */
export async function deleteAircraftFromDatabase(
  registration: string
): Promise<boolean> {
  const key = registration.toUpperCase()
  const aircraft = await referenceDb.aircraftDatabase.get(key)
  if (!aircraft) return false

  await referenceDb.aircraftDatabase.put({ ...aircraft, deletedAt: Date.now() })
  return true
}

/** Put a soft-deleted entry back. */
export async function restoreAircraftInDatabase(
  registration: string
): Promise<boolean> {
  const key = registration.toUpperCase()
  const aircraft = await referenceDb.aircraftDatabase.get(key)
  if (!aircraft) return false

  await referenceDb.aircraftDatabase.put({ ...aircraft, deletedAt: null })
  return true
}

/** Destroy it now rather than in 30 days. */
export async function permanentlyDeleteAircraftFromDatabase(
  registration: string
): Promise<boolean> {
  const key = registration.toUpperCase()
  const aircraft = await referenceDb.aircraftDatabase.get(key)
  if (!aircraft) return false

  await referenceDb.aircraftDatabase.delete(key)
  return true
}

/** Sweep whatever has run out its 30 days. */
export async function purgeExpiredDeletedAircraftReferences(
  now = Date.now()
): Promise<number> {
  const expired = await referenceDb.aircraftDatabase
    .filter(
      (r) =>
        r.deletedAt != null &&
        !isWithinRetention(r.deletedAt, now, DELETED_RETENTION_MS)
    )
    .toArray()
  for (const r of expired) {
    await referenceDb.aircraftDatabase.delete(r.registration)
  }
  return expired.length
}

/** Everything currently in Recently Deleted, newest first. */
export async function getDeletedAircraftReferences(): Promise<
  AircraftReference[]
> {
  const rows = await referenceDb.aircraftDatabase
    .filter((r) => r.deletedAt != null)
    .toArray()
  return rows.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

export async function getAllAircraftFromDatabase(): Promise<AircraftReference[]> {
  // LIVE entries only — a deleted one is in Recently Deleted.
  return referenceDb.aircraftDatabase.filter((r) => r.deletedAt == null).toArray()
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
