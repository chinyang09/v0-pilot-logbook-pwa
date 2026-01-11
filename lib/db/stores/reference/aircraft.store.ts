/**
 * Aircraft database store operations (CDN aircraft reference - read-only)
 */

import { referenceDb } from "../../reference-db";
import type { AircraftReference } from "@/types/entities/aircraft.types";

// ============================================
// Types
// ============================================

export interface AircraftData {
  icao24: string;
  reg: string | null;
  icaotype: string | null;
  short_type: string | null;
}

export interface NormalizedAircraft {
  registration: string;
  icao24: string;
  typecode: string;
  shortType: string;
}

interface AircraftMetadata {
  dataset: string;
  version: string;
  generatedAt: string;
  source: string;
  format: string;
  records: number;
  file: string;
  sha256: string;
}

// ============================================
// Configuration
// ============================================

const AIRCRAFT_CDN_URL =
  "https://cdn.jsdelivr.net/gh/chinyang09/Aircraft-Database@v2025.12.02/data/aircraft-slim.json.gz";
const METADATA_URL =
  "https://cdn.jsdelivr.net/gh/chinyang09/Aircraft-Database@v2025.12.02/data/metadata.json";
const CACHE_VERSION_KEY = "aircraft-database-version";
const CACHE_VERSION = "2025.12.02-slim-v5";
const CACHE_ETAG_KEY = "aircraft-database-etag";

// ============================================
// State
// ============================================

let metadata: AircraftMetadata | null = null;
let loadingPromise: Promise<boolean> | null = null;
let isInitializing = false;
let isReady = false;
let aircraftCache: AircraftData[] | null = null;

// Progress callback
type ProgressCallback = (progress: {
  stage: string;
  percent: number;
  count?: number;
}) => void;
let progressCallback: ProgressCallback | null = null;

// Search cache
const searchCache = new Map<
  string,
  { results: NormalizedAircraft[]; timestamp: number }
>();
const SEARCH_CACHE_TTL = 60000; // 1 minute
const SEARCH_CACHE_MAX_SIZE = 50;

// Worker instance (reusable)
let parserWorker: Worker | null = null;

// ============================================
// Progress reporting
// ============================================

export function setProgressCallback(cb: ProgressCallback | null): void {
  progressCallback = cb;
}

function reportProgress(stage: string, percent: number, count?: number): void {
  if (progressCallback) {
    progressCallback({ stage, percent, count });
  }
}

// ============================================
// Web Worker functions
// ============================================

function getParserWorker(): Worker {
  if (!parserWorker) {
    parserWorker = new Worker("/workers/aircraft-parser.js");
  }
  return parserWorker;
}

function terminateParserWorker(): void {
  if (parserWorker) {
    parserWorker.terminate();
    parserWorker = null;
  }
}

async function parseAircraftWithWorker(
  arrayBuffer: ArrayBuffer
): Promise<{ registration: string; data: string }[]> {
  return new Promise((resolve, reject) => {
    const worker = getParserWorker();

    const handleMessage = (e: MessageEvent) => {
      const { type, stage, percent, count, records, error } = e.data;

      if (type === "progress") {
        reportProgress(stage, percent, count);
      } else if (type === "complete") {
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        resolve(records);
      } else if (type === "error") {
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        reject(new Error(error));
      }
    };

    const handleError = (e: ErrorEvent) => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      reject(new Error(e.message));
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);

    worker.postMessage({ type: "parse", arrayBuffer });
  });
}

// ============================================
// Helper functions
// ============================================

function normalizeForSearch(str: string): string {
  return str.toUpperCase().replace(/-/g, "");
}

function getCachedSearch(query: string): NormalizedAircraft[] | null {
  const normalizedQuery = normalizeForSearch(query);
  const cached = searchCache.get(normalizedQuery);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
    return cached.results;
  }
  searchCache.delete(normalizedQuery);
  return null;
}

function setCachedSearch(query: string, results: NormalizedAircraft[]): void {
  const normalizedQuery = normalizeForSearch(query);
  if (searchCache.size >= SEARCH_CACHE_MAX_SIZE) {
    const oldest = [...searchCache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    )[0];
    if (oldest) searchCache.delete(oldest[0]);
  }
  searchCache.set(normalizedQuery, { results, timestamp: Date.now() });
}

export function normalizeAircraft(aircraft: AircraftData): NormalizedAircraft {
  return {
    registration: aircraft.reg || "",
    icao24: aircraft.icao24 || "",
    typecode: aircraft.icaotype || "",
    shortType: aircraft.short_type || "",
  };
}

export function formatAircraft(aircraft: NormalizedAircraft): string {
  const parts = [aircraft.registration];
  if (aircraft.typecode) parts.push(`(${aircraft.typecode})`);
  return parts.join(" ");
}

// ============================================
// Data loading functions
// ============================================

async function loadMetadata(): Promise<AircraftMetadata | null> {
  try {
    const response = await fetch(METADATA_URL, { cache: "default" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function decompressGzip(compressedData: ArrayBuffer): Promise<string> {
  const uint8Array = new Uint8Array(compressedData);

  // Verify gzip magic bytes (0x1f 0x8b)
  if (uint8Array[0] !== 0x1f || uint8Array[1] !== 0x8b) {
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(uint8Array);
  }

  // Try native DecompressionStream first (faster, no library needed)
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([compressedData]).stream();
      const decompressedStream = stream.pipeThrough(
        new DecompressionStream("gzip")
      );
      const decompressedBlob = await new Response(decompressedStream).blob();
      return await decompressedBlob.text();
    } catch {
      // Fall through to pako
    }
  }

  // Fallback to pako
  const pako = await import("pako");
  const decompressed = pako.ungzip(uint8Array);
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(decompressed);
}

// Helper for fallback main-thread parsing
function parseNDJSON(
  ndjsonText: string
): { registration: string; data: string }[] {
  const records: { registration: string; data: string }[] = [];
  const lines = ndjsonText.split("\n");
  let parsed = 0;
  const estimatedRecords = 615656;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj = JSON.parse(trimmed) as AircraftData;
      if (obj && obj.icao24) {
        records.push({
          registration: obj.icao24.toUpperCase(),
          data: trimmed,
        });
        parsed++;

        if (parsed % 50000 === 0) {
          reportProgress(
            "Parsing",
            40 + Math.round((parsed / estimatedRecords) * 20),
            parsed
          );
        }
      }
    } catch {
      // Skip invalid lines
    }
  }

  return records;
}

async function getCachedCount(): Promise<number> {
  try {
    return await referenceDb.aircraftDatabase.count();
  } catch {
    return 0;
  }
}

function hasCachedData(): boolean {
  return localStorage.getItem(CACHE_VERSION_KEY) === CACHE_VERSION;
}

async function shouldRedownload(): Promise<boolean> {
  const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
  if (cachedVersion !== CACHE_VERSION) return true;

  const count = await getCachedCount();
  if (count < 500000) return true;

  // Check ETag for updates
  try {
    const cachedEtag = localStorage.getItem(CACHE_ETAG_KEY);
    if (!cachedEtag) return false;

    const response = await fetch(AIRCRAFT_CDN_URL, { method: "HEAD" });
    const newEtag = response.headers.get("etag");
    return newEtag !== cachedEtag;
  } catch {
    return false;
  }
}

async function loadAndStoreAircraftFromCDN(): Promise<number> {
  reportProgress("Checking metadata", 0);
  metadata = await loadMetadata();

  reportProgress("Downloading", 5);
  const response = await fetch(AIRCRAFT_CDN_URL, { cache: "default" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const etag = response.headers.get("etag");
  if (etag) {
    localStorage.setItem(CACHE_ETAG_KEY, etag);
  }

  reportProgress("Downloading", 20);
  const arrayBuffer = await response.arrayBuffer();

  // Use web worker for parsing (non-blocking)
  let allRecords: { registration: string; data: string }[];

  if (typeof Worker !== "undefined") {
    // Use worker if available
    try {
      allRecords = await parseAircraftWithWorker(arrayBuffer);
    } catch (workerError) {
      console.warn(
        "[Aircraft DB] Worker failed, falling back to main thread:",
        workerError
      );
      // Fallback to main thread parsing
      reportProgress("Decompressing", 30);
      const ndjsonText = await decompressGzip(arrayBuffer);
      reportProgress("Parsing", 40);
      allRecords = parseNDJSON(ndjsonText);
    }
  } else {
    // Fallback to main thread parsing
    reportProgress("Decompressing", 30);
    const ndjsonText = await decompressGzip(arrayBuffer);
    reportProgress("Parsing", 40);
    allRecords = parseNDJSON(ndjsonText);
  }

  // Store in IndexedDB
  reportProgress("Storing", 90);

  await referenceDb.transaction(
    "rw",
    referenceDb.aircraftDatabase,
    async () => {
      await referenceDb.aircraftDatabase.clear();

      const batchSize = 25000;
      for (let i = 0; i < allRecords.length; i += batchSize) {
        const batch = allRecords.slice(i, i + batchSize);
        await referenceDb.aircraftDatabase.bulkPut(batch);

        const percent =
          90 + Math.round(((i + batch.length) / allRecords.length) * 10);
        reportProgress("Storing", percent, i + batch.length);
      }
    }
  );

  localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
  reportProgress("Complete", 100, allRecords.length);

  // Clean up worker
  terminateParserWorker();

  searchCache.clear();

  return allRecords.length;
}

// ============================================
// Public API - Initialization
// ============================================

export async function quickInit(): Promise<boolean> {
  if (isReady) return true;

  if (hasCachedData()) {
    const count = await getCachedCount();
    if (count > 500000) {
      isReady = true;
      return true;
    }
  }
  return false;
}

export async function initializeAircraftDatabase(): Promise<boolean> {
  if (isReady) return true;

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      const needsDownload = await shouldRedownload();

      if (needsDownload && !isInitializing) {
        isInitializing = true;
        await loadAndStoreAircraftFromCDN();
        isInitializing = false;
      }

      isReady = true;
      return true;
    } catch (error) {
      console.error("[Aircraft DB] Failed to initialize:", error);
      isInitializing = false;

      const count = await getCachedCount();
      if (count > 500000) {
        isReady = true;
        return true;
      }
      return false;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

export function isAircraftDatabaseReady(): boolean {
  return isReady;
}

export function getAircraftMetadata(): AircraftMetadata | null {
  return metadata;
}

export async function clearAircraftCache(): Promise<void> {
  isReady = false;
  metadata = null;
  aircraftCache = null;
  searchCache.clear();
  localStorage.removeItem(CACHE_VERSION_KEY);
  localStorage.removeItem(CACHE_ETAG_KEY);
  await referenceDb.aircraftDatabase.clear();
}

// ============================================
// Public API - Search (DB-based, recommended)
// ============================================

export async function searchAircraftFromDB(
  query: string,
  limit = 50
): Promise<NormalizedAircraft[]> {
  if (!query || query.length < 2) return [];

  const q = query.toUpperCase().trim();
  const qNormalized = normalizeForSearch(q);

  const cached = getCachedSearch(q);
  if (cached) return cached;

  const matches: Array<{ aircraft: AircraftData; score: number }> = [];

  await referenceDb.aircraftDatabase
    .where("registration")
    .startsWithIgnoreCase(qNormalized.charAt(0))
    .until(() => matches.length >= limit * 3)
    .each((record) => {
      try {
        const ac = JSON.parse(record.data) as AircraftData;
        let score = 0;
        const reg = (ac.reg || "").toUpperCase();
        const icaotype = (ac.icaotype || "").toUpperCase();
        const icao24 = (ac.icao24 || "").toUpperCase();
        const shortType = (ac.short_type || "").toUpperCase();

        const regNormalized = normalizeForSearch(reg);

        if (regNormalized && regNormalized === qNormalized) {
          score = 1000;
        } else if (regNormalized && regNormalized.startsWith(qNormalized)) {
          score = 900;
        } else if (regNormalized && regNormalized.includes(qNormalized)) {
          score = 800;
        } else if (icaotype === q) {
          score = 700;
        } else if (icaotype && icaotype.startsWith(q)) {
          score = 600;
        } else if (icao24 === q) {
          score = 550;
        } else if (icao24 && icao24.startsWith(q)) {
          score = 500;
        } else if (shortType === q || (shortType && shortType.includes(q))) {
          score = 400;
        }

        if (score > 0) {
          matches.push({ aircraft: ac, score });
        }
      } catch {
        // Skip invalid records
      }
    });

  matches.sort((a, b) => b.score - a.score);
  const results = matches
    .slice(0, limit)
    .map((m) => normalizeAircraft(m.aircraft));

  setCachedSearch(q, results);

  return results;
}

export async function getAircraftByRegistrationFromDB(
  registration: string
): Promise<NormalizedAircraft | undefined> {
  const reg = registration.toUpperCase();
  const regNormalized = normalizeForSearch(reg);

  let record = await referenceDb.aircraftDatabase.get(reg);

  if (!record) {
    await referenceDb.aircraftDatabase
      .filter((r) => {
        try {
          const ac = JSON.parse(r.data) as AircraftData;
          return normalizeForSearch(ac.reg || "") === regNormalized;
        } catch {
          return false;
        }
      })
      .first()
      .then((r) => {
        record = r;
      });
  }

  if (!record) return undefined;

  try {
    const ac = JSON.parse(record.data) as AircraftData;
    return normalizeAircraft(ac);
  } catch {
    return undefined;
  }
}

export async function getAircraftByIcao24FromDB(
  icao24: string
): Promise<NormalizedAircraft | undefined> {
  const record = await referenceDb.aircraftDatabase.get(icao24.toUpperCase());
  if (!record) return undefined;

  try {
    const ac = JSON.parse(record.data) as AircraftData;
    return normalizeAircraft(ac);
  } catch {
    return undefined;
  }
}

// ============================================
// Legacy API - kept for backward compatibility
// ============================================

// @deprecated - Use searchAircraftFromDB instead
export async function getAircraftDatabase(): Promise<AircraftData[]> {
  if (aircraftCache && aircraftCache.length > 0) {
    return aircraftCache;
  }

  await initializeAircraftDatabase();

  reportProgress("Loading from cache", 0);
  const records = await referenceDb.aircraftDatabase.toArray();

  aircraftCache = records
    .map((r) => {
      try {
        return JSON.parse(r.data) as AircraftData;
      } catch {
        return null;
      }
    })
    .filter((a): a is AircraftData => a !== null);

  reportProgress("Ready", 100, aircraftCache.length);
  return aircraftCache;
}

// @deprecated - Use searchAircraftFromDB instead
export function searchAircraft(
  aircraft: AircraftData[],
  query: string,
  limit = 50
): NormalizedAircraft[] {
  if (!query || query.length < 2) return [];

  const q = query.toUpperCase().trim();
  const qNormalized = normalizeForSearch(q);
  const matches: Array<{ aircraft: AircraftData; score: number }> = [];

  for (const ac of aircraft) {
    let score = 0;
    const reg = (ac.reg || "").toUpperCase();
    const icaotype = (ac.icaotype || "").toUpperCase();
    const icao24 = (ac.icao24 || "").toUpperCase();
    const shortType = (ac.short_type || "").toUpperCase();

    const regNormalized = normalizeForSearch(reg);

    if (regNormalized && regNormalized === qNormalized) {
      score = 1000;
    } else if (regNormalized && regNormalized.startsWith(qNormalized)) {
      score = 900;
    } else if (regNormalized && regNormalized.includes(qNormalized)) {
      score = 800;
    } else if (icaotype === q) {
      score = 700;
    } else if (icaotype && icaotype.startsWith(q)) {
      score = 600;
    } else if (icao24 === q) {
      score = 550;
    } else if (icao24 && icao24.startsWith(q)) {
      score = 500;
    } else if (shortType === q || (shortType && shortType.includes(q))) {
      score = 400;
    }

    if (score > 0) {
      matches.push({ aircraft: ac, score });
    }

    if (matches.length > limit * 3) {
      break;
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit).map((m) => normalizeAircraft(m.aircraft));
}

// @deprecated - Use getAircraftByRegistrationFromDB instead
export function getAircraftByRegistration(
  aircraft: AircraftData[],
  registration: string
): NormalizedAircraft | undefined {
  const reg = registration.toUpperCase();
  const regNormalized = normalizeForSearch(reg);
  const found = aircraft.find(
    (ac) => normalizeForSearch(ac.reg || "") === regNormalized
  );
  return found ? normalizeAircraft(found) : undefined;
}

// @deprecated - Use getAircraftByIcao24FromDB instead
export function getAircraftByIcao24(
  aircraft: AircraftData[],
  icao24: string
): NormalizedAircraft | undefined {
  const found = aircraft.find(
    (ac) => ac.icao24?.toUpperCase() === icao24.toUpperCase()
  );
  return found ? normalizeAircraft(found) : undefined;
}

export function isAircraftDatabaseLoaded(): boolean {
  return isReady || (aircraftCache !== null && aircraftCache.length > 0);
}

export async function loadIntoMemory(): Promise<number> {
  const aircraft = await getAircraftDatabase();
  return aircraft.length;
}

// ============================================
// Basic CRUD operations (from original store)
// ============================================

export async function addAircraftToDatabase(
  registration: string,
  data: string
): Promise<void> {
  await referenceDb.aircraftDatabase.put({
    registration: registration.toUpperCase(),
    data,
  });
}

export async function getAircraftFromDatabase(
  registration: string
): Promise<AircraftReference | undefined> {
  return referenceDb.aircraftDatabase.get(registration.toUpperCase());
}

export async function deleteAircraftFromDatabase(
  registration: string
): Promise<boolean> {
  const aircraft = await referenceDb.aircraftDatabase.get(
    registration.toUpperCase()
  );
  if (!aircraft) return false;

  await referenceDb.aircraftDatabase.delete(registration.toUpperCase());
  return true;
}

export async function getAllAircraftFromDatabase(): Promise<
  AircraftReference[]
> {
  return referenceDb.aircraftDatabase.toArray();
}

export async function hasAircraftInDatabase(
  registration: string
): Promise<boolean> {
  const aircraft = await referenceDb.aircraftDatabase.get(
    registration.toUpperCase()
  );
  return !!aircraft;
}

/**
 * OPTIMIZED BATCH AIRCRAFT LOOKUP
 *
 * Add these functions to lib/db/stores/reference/aircraft.store.ts
 *
 * The key insight: instead of doing N individual lookups (each potentially
 * scanning 600k records), we do ONE full scan and build a lookup map.
 */

// ============================================
// Registration Lookup Cache (for batch operations)
// ============================================

// In-memory normalized registration -> record map
// Built once per session, used for fast lookups
let registrationLookupMap: Map<string, AircraftData> | null = null;
let lookupMapBuildPromise: Promise<void> | null = null;

/**
 * Build the registration lookup map (one-time cost)
 * This parses all records once and creates a normalized lookup table
 */
async function ensureRegistrationLookupMap(): Promise<
  Map<string, AircraftData>
> {
  if (registrationLookupMap) {
    return registrationLookupMap;
  }

  if (lookupMapBuildPromise) {
    await lookupMapBuildPromise;
    return registrationLookupMap!;
  }

  lookupMapBuildPromise = (async () => {
    console.time("[Aircraft DB] Building registration lookup map");

    const map = new Map<string, AircraftData>();

    await referenceDb.aircraftDatabase.each((record) => {
      try {
        const ac = JSON.parse(record.data) as AircraftData;
        if (ac.reg) {
          // Store both normalized (no dashes) and original formats
          const normalized = normalizeForSearch(ac.reg);
          const upper = ac.reg.toUpperCase();

          map.set(normalized, ac);
          if (normalized !== upper) {
            map.set(upper, ac);
          }
        }
      } catch {
        // Skip invalid records
      }
    });

    registrationLookupMap = map;
    console.timeEnd("[Aircraft DB] Building registration lookup map");
    console.log(`[Aircraft DB] Lookup map contains ${map.size} entries`);
  })();

  await lookupMapBuildPromise;
  lookupMapBuildPromise = null;
  return registrationLookupMap!;
}

/**
 * Clear the lookup map (call when clearing aircraft cache)
 */
export function clearRegistrationLookupMap(): void {
  registrationLookupMap = null;
  lookupMapBuildPromise = null;
}

// Add to clearAircraftCache():
// clearRegistrationLookupMap()

// ============================================
// Fast Single Lookup (uses map)
// ============================================

/**
 * FAST registration lookup using pre-built map
 * Use this instead of getAircraftByRegistrationFromDB for better performance
 */
export async function getAircraftByRegistrationFast(
  registration: string
): Promise<NormalizedAircraft | undefined> {
  if (!registration) return undefined;

  const map = await ensureRegistrationLookupMap();

  // Try normalized first, then uppercase
  const normalized = normalizeForSearch(registration);
  const upper = registration.toUpperCase();

  const found = map.get(normalized) || map.get(upper);

  return found ? normalizeAircraft(found) : undefined;
}

// ============================================
// Batch Lookup (most efficient for imports)
// ============================================

/**
 * Batch lookup multiple registrations at once
 * Returns a Map for O(1) lookup by the caller
 *
 * @param registrations - Array of registration strings to look up
 * @returns Map of registration (uppercase) -> NormalizedAircraft
 */
export async function batchGetAircraftByRegistrations(
  registrations: string[]
): Promise<Map<string, NormalizedAircraft>> {
  const results = new Map<string, NormalizedAircraft>();

  if (registrations.length === 0) return results;

  // Dedupe and normalize input
  const uniqueRegs = [...new Set(registrations.map((r) => r.toUpperCase()))];

  // Build lookup map if needed (one-time cost)
  const map = await ensureRegistrationLookupMap();

  // O(n) lookup where n = number of unique registrations
  for (const reg of uniqueRegs) {
    const normalized = normalizeForSearch(reg);
    const found = map.get(normalized) || map.get(reg);

    if (found) {
      results.set(reg, normalizeAircraft(found));
    }
  }

  return results;
}

// ============================================
// Alternative: Lazy-load approach for very large imports
// ============================================

/**
 * For extremely large imports where building the full map is too slow,
 * use this approach that only loads what's needed
 */
export async function batchGetAircraftByRegistrationsLazy(
  registrations: string[]
): Promise<Map<string, NormalizedAircraft>> {
  const results = new Map<string, NormalizedAircraft>();

  if (registrations.length === 0) return results;

  // Dedupe and create lookup sets
  const uniqueRegs = [...new Set(registrations.map((r) => r.toUpperCase()))];
  const normalizedSet = new Set(uniqueRegs.map((r) => normalizeForSearch(r)));
  const upperSet = new Set(uniqueRegs);

  // Track which ones we've found
  const found = new Set<string>();

  // Single pass through database
  await referenceDb.aircraftDatabase
    .until(() => found.size >= uniqueRegs.length) // Stop early when all found
    .each((record) => {
      try {
        const ac = JSON.parse(record.data) as AircraftData;
        if (!ac.reg) return;

        const regUpper = ac.reg.toUpperCase();
        const regNormalized = normalizeForSearch(ac.reg);

        // Check if this is one we're looking for
        if (normalizedSet.has(regNormalized) || upperSet.has(regUpper)) {
          const normalized = normalizeAircraft(ac);

          // Store under all matching keys
          for (const searchReg of uniqueRegs) {
            const searchNorm = normalizeForSearch(searchReg);
            if (searchNorm === regNormalized || searchReg === regUpper) {
              results.set(searchReg, normalized);
              found.add(searchReg);
            }
          }
        }
      } catch {
        // Skip invalid records
      }
    });

  return results;
}
