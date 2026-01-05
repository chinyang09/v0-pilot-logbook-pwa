import Dexie, { type Table } from "dexie";

/**
 * Airport Database Loader
 * Loads local minified JSON and caches in Dexie (IndexedDB)
 */

export interface AirportData {
  id: number; // Required for favorites/recents logic
  icao: string;
  iata: string;
  name: string;
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  altitude: number;
  tz: string; // Timezone name e.g., "America/Los_Angeles"
  source: string;
}

// Configuration
const AIRPORT_SOURCE_URL = "/airports.min.json";
const DB_NAME = "AirportDatabase";
const DATA_VERSION = "2025.10.27-min"; // Change this to force cache refresh

/**
 * Dexie Database Definition
 */
class AirportCacheDB extends Dexie {
  airports!: Table<AirportData, number>;
  metadata!: Table<{ key: string; value: any }, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      airports: "id, icao, iata, name, city", // Indexed for performance
      metadata: "key",
    });
  }
}

const db = new AirportCacheDB();

/**
 * Get airports from Dexie or load from local public folder
 */
export async function getAirportDatabase(): Promise<AirportData[]> {
  try {
    const versionRecord = await db.metadata.get("data_version");
    const count = await db.airports.count();

    // 1. Check if cache is valid
    if (versionRecord?.value === DATA_VERSION && count > 0) {
      return await db.airports.toArray();
    }

    // 2. Fetch from public/airports.min.json
    console.log("[Airport DB] Cache miss or update. Loading local file...");
    const response = await fetch(AIRPORT_SOURCE_URL);
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

    const rawData: Record<string, any> = await response.json();

    // 3. Map Object to Array and normalize keys
    const airports: AirportData[] = Object.values(rawData)
      .map((airport: any, index: number) => ({
        id: index + 1, // Synthetic ID for favorites/tracking
        icao: airport.icao || "",
        iata: airport.iata || "",
        name: airport.name || "",
        city: airport.city || "",
        state: airport.state || "",
        country: airport.country || "",
        latitude: airport.lat || 0,
        longitude: airport.lon || 0,
        altitude: airport.elevation || 0,
        tz: airport.tz || "UTC",
        source: "local-min",
      }))
      .filter((a) => a.icao);

    // 4. Update Dexie
    await db.transaction("rw", db.airports, db.metadata, async () => {
      await db.airports.clear();
      await db.airports.bulkPut(airports);
      await db.metadata.put({ key: "data_version", value: DATA_VERSION });
    });

    return airports;
  } catch (error) {
    console.error("[Airport DB] Critical failure:", error);
    return [];
  }
}

/**
 * Search airports with scoring
 */
export function searchAirports(
  airports: AirportData[],
  query: string,
  limit = 10
): AirportData[] {
  if (!query) return [];

  const q = query.toLowerCase().trim();
  const matches: Array<{ airport: AirportData; score: number }> = [];

  for (const airport of airports) {
    let score = 0;
    const icao = airport.icao.toLowerCase();
    const iata = airport.iata ? airport.iata.toLowerCase() : "";
    const name = airport.name.toLowerCase();
    const city = airport.city.toLowerCase();

    if (icao === q) score = 1000;
    else if (icao.startsWith(q)) score = 900;
    else if (iata === q) score = 850;
    else if (iata.startsWith(q)) score = 750;
    else if (name.startsWith(q)) score = 600;
    else if (city.startsWith(q)) score = 500;
    else if (name.includes(q)) score = 300;
    else if (city.includes(q)) score = 200;

    if (score > 0) matches.push({ airport, score });
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => m.airport);
}

/**
 * Helper: Get current local time and UTC offset for an airport
 */
export function getAirportLocalTime(tz: string) {
  try {
    const now = new Date();
    // Get offset string (e.g., "GMT-5")
    const offsetStr =
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "shortOffset",
      })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value || "UTC";

    // Get time string (e.g., "10:30 AM")
    const timeStr = now.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    });

    return `${timeStr} (${offsetStr})`;
  } catch {
    return "Time Unavailable";
  }
}

/**
 * Format airport for display
 */
export function formatAirport(airport: AirportData): string {
  const parts = [airport.icao];
  if (airport.iata) parts.push(`(${airport.iata})`);
  parts.push(`- ${airport.name}`);
  if (airport.city) parts.push(`- ${airport.city}, ${airport.country}`);

  const localTime = getAirportLocalTime(airport.tz);
  return `${parts.join(" ")} [Local: ${localTime}]`;
}

/**
 * Lookups
 */
export const getAirportByICAO = (airports: AirportData[], icao: string) =>
  airports.find((a) => a.icao.toUpperCase() === icao.toUpperCase());

export const getAirportByIATA = (airports: AirportData[], iata: string) =>
  airports.find((a) => a.iata && a.iata.toUpperCase() === iata.toUpperCase());
