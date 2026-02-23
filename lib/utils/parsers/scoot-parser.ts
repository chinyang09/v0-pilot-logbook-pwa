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
  addCustomAircraftToDatabase,
  type NormalizedAircraft,
} from "@/lib/db/stores/reference/aircraft.store";
import { submitAircraftToServer } from "@/lib/submissions/submit";
import type { AircraftRecord } from "@/types/entities/aircraft.types";

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
  aircraftEnriched: number;
  unmatchedRegistrations: string[];
}

// ============================================
// Main Export
// ============================================

/**
 * Normalizes strings for consistent comparison across different CSV sources.
 * Removes all non-alphanumeric characters and converts to lowercase.
 * e.g., "Kenneth Albert Steph" -> "kennethalbertsteph"
 */
const normalize = (s: string): string =>
  s ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "";

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

  // ========== ENRICHMENT: Resolve unmatched aircraft via server + FR24 ==========
  const unmatchedRegs = Array.from(uniqueRegs).filter(
    (reg) => !aircraftMap.has(reg)
  );

  let aircraftEnriched = 0;
  let unmatchedRegistrations: string[] = [];
  const serverSubmissionQueue: Array<{
    submissionId: string;
    registration: string;
    typecode?: string;
    icao24?: string;
    operator?: string;
  }> = [];

  if (unmatchedRegs.length > 0) {
    onProgress?.(
      30,
      "Enriching aircraft",
      `Looking up ${unmatchedRegs.length} aircraft online...`
    );

    const enrichResult = await enrichUnmatchedAircraft(
      unmatchedRegs,
      (current, total, reg) => {
        const percent = 30 + Math.floor((current / total) * 10);
        onProgress?.(percent, "Enriching aircraft", `${current}/${total}: ${reg}`);
      }
    );

    // Merge enriched results into aircraftMap for the second pass
    for (const [reg, aircraft] of enrichResult.enriched) {
      aircraftMap.set(reg, aircraft);
    }

    aircraftEnriched = enrichResult.enriched.size;
    unmatchedRegistrations = enrichResult.failedRegs;

    // Queue server submissions for FR24-found aircraft
    for (const sub of enrichResult.submissionQueue) {
      serverSubmissionQueue.push(sub);
    }

    console.log(
      `[Scoot Parser] Enrichment: ${aircraftEnriched} found, ${unmatchedRegistrations.length} unresolved`
    );
  }

  // ========== SECOND PASS: Process flights ==========
  onProgress?.(40, "Processing", "Creating/Hydrating flight records...");

  // Build crew cache from existing personnel
  const crewCache = new Map<string, string>();
  const existingCrew = await db.personnel.toArray();

  // Cache by normalized name
  existingCrew.forEach((p) => {
    const norm = normalize(p.name);
    if (norm) crewCache.set(norm, p.id);
  });

  const flightsToSave: FlightLog[] = [];
  const personnelToSave: Personnel[] = [];
  const syncQueueEntries: any[] = [];

  for (let idx = 0; idx < parsedRows.length; idx++) {
    const row = parsedRows[idx];
    const { cols, depIata, arrIata, rawReg, flightDate } = row;

    const depAp = airportMap.get(depIata);
    const arrAp = airportMap.get(arrIata);
    const matchedAc = aircraftMap.get(rawReg.toUpperCase());

    const outT = cols[2]?.trim(); // Actual Out
    const inT = cols[4]?.trim(); // Actual In
    const blockT = cols[7]?.trim();
    const isSim =
      cols[17]?.toUpperCase().includes("SIM") ||
      cols[5]?.toUpperCase().includes("SIM");

    // --- 1. SMART PERSONNEL LOOKUP (Healing Support) ---
    const rawPicName = cols[8]?.replace(/"/g, "").trim() || "";
    const normalizedLogName = normalize(rawPicName);

    let picId = "";
    let picName = rawPicName;
    let sicId = "";
    let sicName = "";

    const isUserPic = normalizedLogName === normalize(currentUserName);

    if (isUserPic) {
      picId = currentUserId;
      picName = currentUserName;
    } else if (normalizedLogName) {
      sicId = currentUserId;
      sicName = currentUserName;

      // SEARCH FOR MASTER: Does this (likely truncated) name match a Full Name in DB?
      const masterMatch = existingCrew.find((p) =>
        normalize(p.name).startsWith(normalizedLogName)
      );

      if (masterMatch) {
        picId = masterMatch.id;
        picName = masterMatch.name; // Use the Full Name from the Schedule
      } else {
        let matchedId = crewCache.get(normalizedLogName);
        if (!matchedId) {
          const newPerson: Personnel = {
            id: crypto.randomUUID(),
            name: rawPicName, // Truncated for now
            createdAt: Date.now(),
            syncStatus: "pending",
            isMe: false,
            roles: ["PIC"],
          };
          personnelToSave.push(newPerson);
          syncQueueEntries.push({
            id: crypto.randomUUID(),
            type: "create",
            collection: "personnel",
            data: newPerson,
            timestamp: Date.now(),
          });
          matchedId = newPerson.id;
          crewCache.set(normalizedLogName, matchedId);
          existingCrew.push(newPerson); // Allow subsequent rows to find this person
        }
        picId = matchedId;
      }
    }

    // --- 2. FIND-OR-CREATE FLIGHT (The Handshake) ---
    const logOutMinutes = hhmmToMinutes(outT || "00:00");

    // Look for a record created by the Schedule Parser today
    const existingDraft = await db.flights
      .where("date")
      .equals(flightDate)
      .filter(
        (f) =>
          f.departureIata === depIata &&
          f.arrivalIata === arrIata &&
          Math.abs(
            hhmmToMinutes(f.scheduledOut || f.outTime || "00:00") -
              logOutMinutes
          ) < 90
      )
      .first();

    const flightId = existingDraft ? existingDraft.id : crypto.randomUUID();

    const depOffset = depAp ? getAirportTimeInfo(depAp.tz).offset : 0;
    const arrOffset = arrAp ? getAirportTimeInfo(arrAp.tz).offset : 0;

    // Calculate Night Time
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
          ).nightTimeHHMM
        : "00:00";

    // --- 3. MERGE & HYDRATE ---
    const flight: FlightLog = {
      ...existingDraft, // PRESERVE Flight Number (TRxxx) from Schedule
      id: flightId,
      isDraft: false,
      date: flightDate,
      aircraftReg: matchedAc?.registration || rawReg,
      aircraftType: matchedAc?.typecode || cols[5] || "",
      departureIata: depIata,
      departureIcao: depAp?.icao || "",
      arrivalIata: arrIata,
      arrivalIcao: arrAp?.icao || "",
      departureTimezone: depOffset,
      arrivalTimezone: arrOffset,
      outTime: outT || "",
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
      pilotRole: isUserPic ? "PIC" : "SIC",
      picTime: isUserPic ? blockT || "00:00" : "00:00",
      sicTime: !isUserPic ? blockT || "00:00" : "00:00",
      dayTakeoffs: parseInt(cols[9]) || 0,
      nightTakeoffs: parseInt(cols[10]) || 0,
      dayLandings: parseInt(cols[11]) || 0,
      nightLandings: parseInt(cols[12]) || 0,
      remarks: cols[17]?.trim() || "",
      updatedAt: Date.now(),
      syncStatus: "pending",
    };

    flightsToSave.push(flight);

    syncQueueEntries.push({
      id: crypto.randomUUID(),
      type: existingDraft ? "update" : "create",
      collection: "flights",
      data: flight,
      timestamp: Date.now(),
    });

    if (idx % 50 === 0) {
      const percent = 40 + Math.floor((idx / parsedRows.length) * 40);
      onProgress?.(percent, "Processing", `${idx + 1} flights...`);
    }
  }

  // Final step: Ensure you use db.flights.bulkPut(flightsToSave) in the transaction!

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
        // bulkPut handles both new inserts and updates to existing IDs (Drafts)
        await db.flights.bulkPut(flightsToSave);
      }
      if (syncQueueEntries.length > 0) {
        await db.syncQueue.bulkAdd(syncQueueEntries);
      }
    }
  );

  // Fire-and-forget: submit FR24-enriched aircraft to server
  if (serverSubmissionQueue.length > 0) {
    for (const submission of serverSubmissionQueue) {
      submitAircraftToServer(submission);
    }
    console.log(
      `[Scoot Parser] Queued ${serverSubmissionQueue.length} aircraft for server submission`
    );
  }

  onProgress?.(100, "Complete", `Imported ${flightsToSave.length} flights`);

  console.log(
    `[Scoot Parser] Successfully imported ${flightsToSave.length} flights, ${personnelToSave.length} new crew, ${aircraftEnriched} aircraft enriched`
  );

  return {
    flightsImported: flightsToSave.length,
    personnelCreated: personnelToSave.length,
    errors,
    aircraftEnriched,
    unmatchedRegistrations,
  };
}

// ============================================
// Helper: Batch fetch airports
// ============================================

// ============================================
// Helper: 3-tier aircraft enrichment (server → FR24 → fail)
// ============================================

function normalizeReg(reg: string): string {
  return reg.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

async function enrichUnmatchedAircraft(
  unmatchedRegs: string[],
  onProgress?: (current: number, total: number, reg: string) => void
): Promise<{
  enriched: Map<string, NormalizedAircraft>;
  submissionQueue: Array<{
    submissionId: string;
    registration: string;
    typecode?: string;
    icao24?: string;
    operator?: string;
  }>;
  failedRegs: string[];
}> {
  const enriched = new Map<string, NormalizedAircraft>();
  const submissionQueue: Array<{
    submissionId: string;
    registration: string;
    typecode?: string;
    icao24?: string;
    operator?: string;
  }> = [];
  const failedRegs: string[] = [];

  if (unmatchedRegs.length === 0) {
    return { enriched, submissionQueue, failedRegs };
  }

  // --- Step 1: Batch check MongoDB enriched submissions ---
  let remainingRegs = [...unmatchedRegs];
  try {
    const batchRes = await fetch("/api/search/aircraft/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrations: unmatchedRegs }),
      signal: AbortSignal.timeout(5000),
    });

    if (batchRes.ok) {
      const { results } = await batchRes.json();
      const normalizedMap = results as Record<
        string,
        {
          registration: string; typecode: string; icao24: string; operator: string;
          shortDescription: string; wtc: string; wtg: string; manufacturerCode: string;
        }
      >;

      for (const reg of unmatchedRegs) {
        const normalized = normalizeReg(reg);
        const match = normalizedMap[normalized];
        if (match) {
          enriched.set(reg, {
            registration: match.registration,
            icao24: match.icao24 || "",
            typecode: match.typecode || "",
            shortDescription: match.shortDescription || "",
            wtc: match.wtc || "",
            wtg: match.wtg || "",
            manufacturerCode: match.manufacturerCode || "",
            operator: match.operator || "",
          });

          // Also persist to local DB for future lookups
          const record: AircraftRecord = {
            registration: match.registration,
            icao24: match.icao24 || "",
            typecode: match.typecode || "",
            operator: match.operator || "",
            shortDescription: match.shortDescription || "",
            wtc: match.wtc || "",
            wtg: match.wtg || "",
            manufacturerCode: match.manufacturerCode || "",
            source: "fr24",
          };
          addCustomAircraftToDatabase(record).catch(() => {});
        }
      }

      remainingRegs = unmatchedRegs.filter(
        (reg) => !enriched.has(reg)
      );
    }
  } catch {
    // Server unreachable — continue to FR24
  }

  // --- Step 2: FR24 individual lookups for remaining ---
  if (remainingRegs.length > 0) {
    const fr24Results = await Promise.allSettled(
      remainingRegs.map(async (reg, index) => {
        try {
          const res = await fetch(
            `/api/search/aircraft?q=${encodeURIComponent(reg)}`,
            { signal: AbortSignal.timeout(5000) }
          );

          if (!res.ok) {
            failedRegs.push(reg);
            return;
          }

          const data = await res.json();
          const match = data.results?.[0];

          if (match && match.registration) {
            const record: AircraftRecord = {
              registration: match.registration,
              icao24: match.icao24 || "",
              typecode: match.typecode || "",
              operator: match.operator || "",
              source: "fr24",
            };
            const submissionId = await addCustomAircraftToDatabase(record);

            enriched.set(reg, {
              registration: match.registration,
              icao24: match.icao24 || "",
              typecode: match.typecode || "",
              shortDescription: "",
              wtc: "",
              wtg: "",
              manufacturerCode: "",
              operator: match.operator || "",
            });

            submissionQueue.push({
              submissionId,
              registration: match.registration,
              typecode: match.typecode,
              icao24: match.icao24,
              operator: match.operator,
            });
          } else {
            failedRegs.push(reg);
          }
        } catch {
          failedRegs.push(reg);
        }

        onProgress?.(index + 1, remainingRegs.length, reg);
      })
    );
  }

  return { enriched, submissionQueue, failedRegs };
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
