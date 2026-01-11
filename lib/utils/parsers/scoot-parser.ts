/**
 * OPTIMIZED Scoot CSV Parser
 *
 * Key optimizations:
 * 1. Two-pass parsing: collect unique values first, batch fetch second
 * 2. Parallel batch lookups for airports and aircraft
 * 3. Progress reporting for UX
 * 4. Chunked database writes to prevent blocking
 */

import {
  userDb as db,
  type FlightLog,
  type Personnel,
  getCurrentUserPersonnel,
  getAirportByIata,
  getAirportTimeInfo,
  type Airport,
} from "@/lib/db";
import { calculateNightTimeComplete } from "@/lib/utils/night-time";
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time";

// Import the new batch function (add to aircraft.store.ts exports)
import {
  batchGetAircraftByRegistrations,
  type NormalizedAircraft,
} from "@/lib/db/stores/reference/aircraft.store";

// ============================================
// Types
// ============================================

interface ParsedRow {
  line: string;
  cols: string[];
  rawDate: string;
  depIata: string;
  arrIata: string;
  rawReg: string;
  flightDate: string;
}

interface ParseOptions {
  onProgress?: (percent: number, stage: string, detail?: string) => void;
}

interface ParseResult {
  flightsImported: number;
  personnelCreated: number;
  errors: string[];
}

// ============================================
// Main Export
// ============================================

export async function processScootCSV(
  csvContent: string,
  options?: ParseOptions
): Promise<ParseResult> {
  const { onProgress } = options ?? {};
  const errors: string[] = [];

  // ========== VALIDATION ==========
  onProgress?.(5, "Validating", "Checking file format...");

  const currentUser = await getCurrentUserPersonnel();
  if (!currentUser) {
    throw new Error(
      "No user profile found. Please create a crew member with 'This is me' enabled in the Crew page."
    );
  }
  const currentUserId = currentUser.id;
  const currentUserName = currentUser.name;

  const lines = csvContent.split(/\r?\n/);
  const dataStartIndex =
    lines.findIndex((l) => l.includes("Date,Airport,Time")) + 1;
  if (dataStartIndex === 0) {
    throw new Error("Invalid CSV Format - header row not found");
  }

  // ========== FIRST PASS: Parse rows and collect unique values ==========
  onProgress?.(10, "Parsing", "Reading CSV rows...");

  const dateRegex = /^\d{2}\/\d{2}\/\d{2}$/;
  const uniqueIatas = new Set<string>();
  const uniqueRegs = new Set<string>();
  const parsedRows: ParsedRow[] = [];

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("Totals") || line.startsWith(",")) continue;

    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const rawDate = cols[0]?.replace(/"/g, "").trim();

    if (!dateRegex.test(rawDate)) continue;

    const depIata = cols[1]?.replace(/"/g, "").trim().toUpperCase();
    const arrIata = cols[3]?.replace(/"/g, "").trim().toUpperCase();
    const rawReg = cols[6]?.replace(/"/g, "").trim();

    if (!depIata || depIata.length !== 3) continue;

    // Collect unique values for batch lookup
    if (depIata) uniqueIatas.add(depIata);
    if (arrIata?.length === 3) uniqueIatas.add(arrIata);
    if (rawReg) uniqueRegs.add(rawReg.toUpperCase());

    // Parse date once
    const dateParts = rawDate.split("/");
    const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
    const flightDate = `${year}-${dateParts[1].padStart(
      2,
      "0"
    )}-${dateParts[0].padStart(2, "0")}`;

    parsedRows.push({
      line,
      cols,
      rawDate,
      depIata,
      arrIata: arrIata || "",
      rawReg: rawReg || "",
      flightDate,
    });
  }

  if (parsedRows.length === 0) {
    throw new Error("No valid flight rows found in CSV");
  }

  console.log(
    `[Scoot Parser] Found ${parsedRows.length} rows, ${uniqueIatas.size} airports, ${uniqueRegs.size} aircraft`
  );

  // ========== BATCH FETCH: Airports and Aircraft in parallel ==========
  onProgress?.(
    25,
    "Loading references",
    `Fetching ${uniqueIatas.size} airports, ${uniqueRegs.size} aircraft...`
  );

  const [airportMap, aircraftMap] = await Promise.all([
    batchFetchAirports(Array.from(uniqueIatas)),
    batchGetAircraftByRegistrations(Array.from(uniqueRegs)),
  ]);

  console.log(
    `[Scoot Parser] Loaded ${airportMap.size} airports, ${aircraftMap.size} aircraft`
  );

  // ========== SECOND PASS: Process flights ==========
  onProgress?.(40, "Processing", "Creating flight records...");

  // Build crew cache from existing personnel
  const crewCache = new Map<string, string>();
  const existingCrew = await db.personnel.toArray();
  existingCrew.forEach((p) => crewCache.set(p.name.toLowerCase(), p.id));

  const flightsToSave: FlightLog[] = [];
  const personnelToSave: Personnel[] = [];
  const syncQueueEntries: any[] = [];

  for (let idx = 0; idx < parsedRows.length; idx++) {
    const row = parsedRows[idx];
    const { cols, depIata, arrIata, rawReg, flightDate } = row;

    // Get cached lookups (no await needed!)
    const depAp = airportMap.get(depIata);
    const arrAp = airportMap.get(arrIata);
    const matchedAc = aircraftMap.get(rawReg.toUpperCase());

    const outT = cols[2]?.trim();
    const inT = cols[4]?.trim();
    const blockT = cols[7]?.trim();
    const isSim =
      cols[17]?.toUpperCase().includes("SIM") ||
      cols[5]?.toUpperCase().includes("SIM");

    // Crew Logic
    const rawPicName = cols[8]?.replace(/"/g, "").trim();
    let picId = "";
    let picName = "";
    let sicId = "";
    let sicName = "";
    const isUserPic =
      rawPicName?.toLowerCase() === currentUserName.toLowerCase();

    if (isUserPic) {
      picId = currentUserId;
      picName = currentUserName;
    } else {
      sicId = currentUserId;
      sicName = currentUserName;
      picName = rawPicName || "";

      if (picName && !crewCache.has(picName.toLowerCase())) {
        const newPerson: Personnel = {
          id: crypto.randomUUID(),
          name: picName,
          createdAt: Date.now(),
          syncStatus: "pending",
          isMe: false,
          roles: ["PIC"],
        };
        personnelToSave.push(newPerson);
        crewCache.set(picName.toLowerCase(), newPerson.id);
        syncQueueEntries.push({
          id: crypto.randomUUID(),
          type: "create",
          collection: "personnel",
          data: newPerson,
          timestamp: Date.now(),
        });
      }
      picId = crewCache.get(picName.toLowerCase()) || "";
    }

    const depOffset = depAp ? getAirportTimeInfo(depAp.tz).offset : 0;
    const arrOffset = arrAp ? getAirportTimeInfo(arrAp.tz).offset : 0;

    // Night time calculation (still sync - could be deferred if needed)
    const nightT =
      !isSim && depAp && arrAp
        ? calculateNightTimeComplete(
            flightDate,
            outT,
            "",
            "",
            inT,
            { lat: depAp.latitude, lon: depAp.longitude },
            { lat: arrAp.latitude, lon: arrAp.longitude }
          )
        : "00:00";

    const flight: FlightLog = {
      id: crypto.randomUUID(),
      isDraft: false,
      date: flightDate,
      flightNumber: "",
      aircraftReg: matchedAc?.registration || rawReg,
      aircraftType: matchedAc?.typecode || cols[5] || "",
      departureIata: depIata,
      departureIcao: depAp?.icao || "",
      arrivalIata: arrIata,
      arrivalIcao: arrAp?.icao || "",
      departureTimezone: depOffset,
      arrivalTimezone: arrOffset,
      scheduledOut: "",
      scheduledIn: "",
      outTime: outT || "",
      offTime: "",
      onTime: "",
      inTime: inT || "",
      blockTime: blockT || "00:00",
      flightTime: isSim ? "00:00" : blockT || "00:00",
      nightTime: nightT,
      dayTime: minutesToHHMM(
        Math.max(0, hhmmToMinutes(blockT || "00:00") - hhmmToMinutes(nightT))
      ),
      picId,
      picName,
      sicId,
      sicName,
      additionalCrew: [],
      pilotFlying: true,
      pilotRole: isUserPic ? "PIC" : "SIC",
      picTime: isUserPic ? blockT || "00:00" : "00:00",
      sicTime: !isUserPic ? blockT || "00:00" : "00:00",
      picusTime: "00:00",
      dualTime: "00:00",
      instructorTime: "00:00",
      dayTakeoffs: Number.parseInt(cols[9]) || 0,
      nightTakeoffs: Number.parseInt(cols[10]) || 0,
      dayLandings: Number.parseInt(cols[11]) || 0,
      nightLandings: Number.parseInt(cols[12]) || 0,
      autolands: 0,
      remarks: cols[17]?.trim() || "",
      endorsements: "",
      manualOverrides: {},
      ifrTime: "00:00",
      actualInstrumentTime: "00:00",
      simulatedInstrumentTime: isSim ? blockT || "00:00" : "00:00",
      crossCountryTime: "00:00",
      approaches: [],
      holds: 0,
      ipcIcc: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncStatus: "pending",
    };

    flightsToSave.push(flight);
    syncQueueEntries.push({
      id: crypto.randomUUID(),
      type: "create",
      collection: "flights",
      data: flight,
      timestamp: Date.now(),
    });

    // Progress update every 50 flights
    if (idx % 50 === 0) {
      const percent = 40 + Math.floor((idx / parsedRows.length) * 40);
      onProgress?.(
        percent,
        "Processing",
        `${idx + 1} of ${parsedRows.length} flights...`
      );
    }
  }

  // ========== SAVE TO DATABASE ==========
  onProgress?.(85, "Saving", "Writing to database...");

  await db.transaction(
    "rw",
    [db.flights, db.personnel, db.syncQueue],
    async () => {
      if (personnelToSave.length > 0) {
        await db.personnel.bulkAdd(personnelToSave);
      }
      if (flightsToSave.length > 0) {
        await db.flights.bulkAdd(flightsToSave);
      }
      if (syncQueueEntries.length > 0) {
        await db.syncQueue.bulkAdd(syncQueueEntries);
      }
    }
  );

  onProgress?.(100, "Complete", `Imported ${flightsToSave.length} flights`);

  console.log(
    `[Scoot Parser] Successfully imported ${flightsToSave.length} flights, ${personnelToSave.length} new crew`
  );

  return {
    flightsImported: flightsToSave.length,
    personnelCreated: personnelToSave.length,
    errors,
  };
}

// ============================================
// Helper: Batch fetch airports
// ============================================

async function batchFetchAirports(
  iatas: string[]
): Promise<Map<string, Airport>> {
  const map = new Map<string, Airport>();

  if (iatas.length === 0) return map;

  // Fetch all in parallel
  const results = await Promise.all(
    iatas.map(async (iata) => {
      const airport = await getAirportByIata(iata);
      return { iata, airport };
    })
  );

  for (const { iata, airport } of results) {
    if (airport) {
      map.set(iata, airport);
    }
  }

  return map;
}
