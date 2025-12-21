import { db, type CDNAircraft } from "./indexed-db";

// Raw data structure from the CDN JSON lines
export interface AircraftData {
  icao24: string;
  reg: string | null;
  icaotype: string | null;
  short_type: string | null;
  model?: string;
  manufacturer?: string;
}

export interface NormalizedAircraft {
  registration: string;
  icao24: string;
  typecode: string;
  shortType: string;
}

const AIRCRAFT_CDN_URL =
  "https://cdn.jsdelivr.net/gh/chinyang09/Aircraft-Database@v2025.12.02/data/aircraft-slim.json.gz";
const METADATA_URL =
  "https://cdn.jsdelivr.net/gh/chinyang09/Aircraft-Database@v2025.12.02/data/metadata.json";
const CACHE_VERSION_KEY = "aircraft-database-version";
const CACHE_VERSION = "2025.12.02-slim-v4";

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

let metadata: AircraftMetadata | null = null;

type ProgressCallback = (progress: {
  stage: string;
  percent: number;
  count?: number;
}) => void;
let progressCallback: ProgressCallback | null = null;

export function setProgressCallback(cb: ProgressCallback | null): void {
  progressCallback = cb;
}

function reportProgress(stage: string, percent: number, count?: number): void {
  if (progressCallback) {
    progressCallback({ stage, percent, count });
  }
}

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

  // Dynamic import pako
  const pako = await import("pako");
  const decompressed = pako.ungzip(uint8Array);
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(decompressed);
}

// CHANGED: Yields batches of clean CDNAircraft objects instead of raw strings
function* parseNDJSONChunked(
  text: string,
  chunkSize = 5000
): Generator<CDNAircraft[]> {
  const lines = text.split("\n");
  let batch: CDNAircraft[] = [];
  let totalParsed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const obj = JSON.parse(line) as AircraftData;
      if (obj && obj.icao24) {
        // Create the optimized storage object immediately
        batch.push({
          registration: (obj.reg || obj.icao24).toUpperCase(),
          icao24: obj.icao24.toUpperCase(),
          icaotype: (obj.icaotype || "").toUpperCase(),
          short_type: (obj.short_type || "").toUpperCase(),
          model: obj.model || "",
          manufacturer: obj.manufacturer || "",
        });
        totalParsed++;
      }
    } catch {
      // Skip invalid lines
    }

    if (batch.length >= chunkSize) {
      yield batch;
      reportProgress(
        "Parsing",
        Math.round((i / lines.length) * 100),
        totalParsed
      );
      batch = [];
    }
  }

  if (batch.length > 0) {
    yield batch;
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

  reportProgress("Downloading", 20);
  const arrayBuffer = await response.arrayBuffer();

  reportProgress("Decompressing", 30);
  const ndjsonText = await decompressGzip(arrayBuffer);

  await db.aircraftDatabase.clear();

  reportProgress("Parsing & Storing", 40);
  let totalStored = 0;

  // CHANGED: Store objects directly using the generator
  for (const batch of parseNDJSONChunked(ndjsonText, 5000)) {
    // Store in IndexedDB
    await db.aircraftDatabase.bulkPut(batch);

    totalStored += batch.length;
    reportProgress(
      "Storing",
      40 + Math.round((totalStored / 615656) * 55),
      totalStored
    );

    // Allow UI to breathe
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
  reportProgress("Complete", 100, totalStored);

  return totalStored;
}

function hasCachedData(): boolean {
  return localStorage.getItem(CACHE_VERSION_KEY) === CACHE_VERSION;
}

let isInitializing = false;

// CHANGED: Renamed for clarity. Checks existence only.
export async function initializeDatabase(): Promise<boolean> {
  if (isInitializing) return false;

  if (hasCachedData()) {
    // Quick check to verify we actually have data
    try {
      const count = await db.aircraftDatabase.count();
      if (count > 500000) return true;
    } catch {
      // If count fails, assume broken
    }
  }

  try {
    isInitializing = true;
    await loadAndStoreAircraftFromCDN();
    return true;
  } catch (error) {
    console.error("[Aircraft DB] Failed to initialize:", error);
    return false;
  } finally {
    isInitializing = false;
  }
}

export function normalizeAircraft(aircraft: CDNAircraft): NormalizedAircraft {
  return {
    registration: aircraft.registration || "",
    icao24: aircraft.icao24 || "",
    typecode: aircraft.icaotype || "",
    shortType: aircraft.short_type || "",
  };
}

// CHANGED: Fully Async Search against IndexedDB
export async function searchAircraft(
  query: string,
  limit = 50
): Promise<NormalizedAircraft[]> {
  if (!query || query.length < 2) return [];

  const q = query.toUpperCase().trim();

  // Parallel queries to leverage Indexes
  // 1. Exact match or StartsWith Registration (Priority 1)
  // 2. Exact match or StartsWith Type (Priority 2)
  // 3. Exact match or StartsWith ICAO24 (Priority 3)

  // Note: Dexie 'startsWith' is case sensitive usually, but we stored everything UpperCase.
  const [byReg, byType, byIcao] = await Promise.all([
    db.aircraftDatabase
      .where("registration")
      .startsWith(q)
      .limit(limit)
      .toArray(),
    db.aircraftDatabase.where("icaotype").startsWith(q).limit(limit).toArray(),
    db.aircraftDatabase.where("icao24").startsWith(q).limit(limit).toArray(),
  ]);

  // Combine and deduplicate based on registration
  const map = new Map<string, CDNAircraft & { score: number }>();

  const addToMap = (items: CDNAircraft[], baseScore: number) => {
    for (const item of items) {
      const key = item.registration;
      if (!map.has(key)) {
        let score = baseScore;
        // refine score for exact matches
        if (item.registration === q) score += 200;
        if (item.icaotype === q) score += 100;
        map.set(key, { ...item, score });
      }
    }
  };

  addToMap(byReg, 1000);
  addToMap(byType, 500);
  addToMap(byIcao, 300);

  return Array.from(map.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(normalizeAircraft);
}

export async function getAircraftByRegistration(
  registration: string
): Promise<NormalizedAircraft | undefined> {
  const found = await db.aircraftDatabase.get(registration.toUpperCase());
  return found ? normalizeAircraft(found) : undefined;
}

export function isAircraftDatabaseLoaded(): boolean {
  return hasCachedData();
}

export function getAircraftMetadata(): AircraftMetadata | null {
  return metadata;
}

export async function clearAircraftCache(): Promise<void> {
  metadata = null;
  localStorage.removeItem(CACHE_VERSION_KEY);
  await db.aircraftDatabase.clear();
}
