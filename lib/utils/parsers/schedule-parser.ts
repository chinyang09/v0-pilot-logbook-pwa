/**
 * Scoot Schedule CSV Parser
 *
 * Parses "Personal Crew Schedule Report" CSV exports from Scoot
 * Handles both UTC and Local Base time references
 * Handles variable column structures between exports
 */

import type {
  ScheduleEntry,
  ScheduledSector,
  ScheduledCrewMember,
  Currency,
  TimeReference,
  DutyType,
  ScheduleImportResult,
  CrewRole,
  Discrepancy,
} from "@/types/entities/roster.types";
import type { Personnel } from "@/types/entities/crew.types";
import type { FlightLog } from "@/types/entities/flight.types";
import {
  userDb,
  getAirportByIata,
  getAirportTimeInfo,
  getAllPersonnel,
  getCurrentUserPersonnel,
} from "@/lib/db";
import { calculateNightTimeComplete } from "@/lib/utils/night-time";
import {
  hhmmToMinutes,
  minutesToHHMM,
  calculateDuration,
} from "@/lib/utils/time";

// ============================================
// Types
// ============================================

interface ParseOptions {
  onProgress?: (percent: number, stage: string, detail?: string) => void;
  sourceFile?: string;
}

// ============================================
// Constants
// ============================================

const DUTY_CODE_MAP: Record<string, { type: DutyType; description: string }> = {
  LOFF: { type: "off", description: "Local Day Off for Tech Crew" },
  OOFF: { type: "off", description: "Overseas Off" },
  CSL: { type: "leave", description: "Sick Leave" },
  ALL: { type: "leave", description: "Annual Leave" },
  CCL: { type: "leave", description: "Childcare Leave" },
  BKUP: { type: "standby", description: "Backup" },
  SBYG: { type: "standby", description: "Standby G: 1800L - 0600L +1" },
  SBYA: { type: "standby", description: "Standby A" },
  EBT1: { type: "training", description: "EBT Day 1" },
  EBT2: { type: "training", description: "EBT Day 2" },
};

// Only track pilots - cabin crew not stored
const CREW_ROLE_MAP: Record<string, CrewRole> = {
  CPT: "CPT",
  PIC: "PIC",
  FO: "FO",
};

// Roles to skip (cabin crew)
const SKIP_ROLES = new Set(["CL", "CIC", "CC", "DHC", "INS", "TRN"]);

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ============================================
// CSV Parsing Utilities
// ============================================

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result.map((s) => s.replace(/^"|"$/g, "").trim());
}

function parseDDMMYYYY(dateStr: string): string {
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return "";
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// ============================================
// Header Parsing
// ============================================

interface ParsedHeader {
  timeReference: TimeReference;
  dateRange: { start: string; end: string };
  crewInfo: {
    crewId: string;
    name: string;
    base: string;
    role: string;
    aircraftType: string;
  };
  columnIndices: {
    date: number;
    duties: number;
    details: number;
    reportTimes: number;
    actualTimes: number;
    debriefTimes: number;
    indicators: number;
    crew: number;
  };
  dataStartIndex: number;
}

function parseHeader(lines: string[]): ParsedHeader {
  // Detect time reference
  let timeReference: TimeReference = "UTC";
  let dateRange = { start: "", end: "" };

  for (const line of lines.slice(0, 10)) {
    if (line.includes("All times in")) {
      timeReference = line.includes("Local Base") ? "LOCAL_BASE" : "UTC";
      const dateMatch = line.match(
        /(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/
      );
      if (dateMatch) {
        dateRange = {
          start: parseDDMMYYYY(dateMatch[1]),
          end: parseDDMMYYYY(dateMatch[2]),
        };
      }
    }
  }

  // Extract crew info
  let crewInfo = {
    crewId: "",
    name: "",
    base: "SIN",
    role: "",
    aircraftType: "",
  };
  for (const line of lines.slice(0, 10)) {
    const cleanLine = line.replace(/"/g, "");
    const crewMatch = cleanLine.match(
      /^(\d{4,5})\s+(.+?)\s+(SIN|[A-Z]{3}),\s*(\w+),\s*(\w+)/
    );
    if (crewMatch) {
      crewInfo = {
        crewId: crewMatch[1],
        name: crewMatch[2].trim(),
        base: crewMatch[3],
        role: crewMatch[4],
        aircraftType: crewMatch[5],
      };
      break;
    }
  }

  // Find header row
  let dataStartIndex = -1;
  let columnIndices = {
    date: 0,
    duties: 1,
    details: 2,
    reportTimes: 3,
    actualTimes: 4,
    debriefTimes: 5,
    indicators: 6,
    crew: 7,
  };

  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].startsWith("Date,Duties") ||
      lines[i].includes("Date,Duties")
    ) {
      dataStartIndex = i + 1;
      const headers = parseCSVLine(lines[i]);

      // Handle extra empty column between Duties and Details
      if (headers[2] === "") {
        columnIndices = {
          date: 0,
          duties: 1,
          details: 3,
          reportTimes: 4,
          actualTimes: 5,
          debriefTimes: 6,
          indicators: 7,
          crew: 8,
        };
      }
      break;
    }
  }

  if (dataStartIndex === -1) {
    throw new Error("Could not find schedule data header row");
  }

  return { timeReference, dateRange, crewInfo, columnIndices, dataStartIndex };
}

// ============================================
// Duty Parsing
// ============================================

function parseDutiesColumn(
  dutiesCell: string,
  detailsCell: string
): {
  dutyCode: string;
  dutyType: DutyType;
  dutyDescription: string;
  sectors: ScheduledSector[];
} {
  const dutyCode = dutiesCell.trim();
  const upperCode = dutyCode.toUpperCase();

  if (DUTY_CODE_MAP[upperCode]) {
    return {
      dutyCode,
      dutyType: DUTY_CODE_MAP[upperCode].type,
      dutyDescription: DUTY_CODE_MAP[upperCode].description,
      sectors: [],
    };
  }

  if (/^EBT\d/i.test(upperCode)) {
    return {
      dutyCode,
      dutyType: "training",
      dutyDescription: detailsCell || dutyCode,
      sectors: [],
    };
  }

  // Parse flight sectors
  const dutyLines = dutiesCell.split(/\r?\n/).filter(Boolean);
  const detailLines = detailsCell.split(/\r?\n/).filter(Boolean);
  const sectors: ScheduledSector[] = [];

  for (let i = 0; i < dutyLines.length; i++) {
    const dutyLine = dutyLines[i].trim();
    const detailLine = detailLines[i]?.trim() || "";

    const flightMatch = dutyLine.match(/^(\w*\d+)\s*\[(\w+)\]$/);
    if (!flightMatch) continue;

    const routeMatch = detailLine.match(/^(\w{3})\s*-\s*(\w{3})/);
    if (!routeMatch) continue;

    sectors.push({
      flightNumber: flightMatch[1],
      aircraftType: flightMatch[2],
      departureIata: routeMatch[1].toUpperCase(),
      arrivalIata: routeMatch[2].toUpperCase(),
      scheduledOut: "",
      scheduledIn: "",
    });
  }

  return {
    dutyCode,
    dutyType: sectors.length > 0 ? "flight" : "other",
    dutyDescription: "",
    sectors,
  };
}

// ============================================
// Time Parsing
// ============================================

function parseActualTimes(timesCell: string, sectors: ScheduledSector[]): void {
  const timeLines = timesCell.split(/\r?\n/).filter(Boolean);

  for (let i = 0; i < Math.min(timeLines.length, sectors.length); i++) {
    const timeLine = timeLines[i].trim();
    const sector = sectors[i];

    const timeMatch = timeLine.match(
      /A?(\d{2}:\d{2})(?:⁺¹)?\s*-\s*A?(\d{2}:\d{2})(?:⁺¹)?(?:\/(\d{2}:\d{2}))?/
    );

    if (timeMatch) {
      const hasActualPrefix = timeLine.includes("A");
      if (hasActualPrefix) {
        sector.actualOut = timeMatch[1];
        sector.actualIn = timeMatch[2];
      } else {
        sector.scheduledOut = timeMatch[1];
        sector.scheduledIn = timeMatch[2];
      }

      if (timeMatch[3]) {
        const [hh, mm] = timeMatch[3].split(":").map(Number);
        sector.delay = hh * 60 + mm;
      }

      sector.nextDay = timeLine.includes("⁺¹");
    }
  }
}

// ============================================
// Crew Parsing (Pilots Only)
// ============================================

function parseCrewColumn(crewCell: string): ScheduledCrewMember[] {
  const crew: ScheduledCrewMember[] = [];
  const lines = crewCell.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    // This regex handles: "Role - ID - Name" AND "Role - Role - ID - Name"
    // It captures the name as everything following the last hyphen
    const match = line.match(
      /^([A-Z\s]+?)\s-\s(?:[A-Z\s]+?\s-\s)?(\d+)\s-\s(.+)$/
    );

    if (match) {
      const rolePart = match[1].trim().toUpperCase();
      const crewId = match[2];
      const name = match[3].trim();

      // Check if the role is in our Pilot map (CPT, PIC, FO)
      // This automatically filters out CL, CC, etc.
      if (CREW_ROLE_MAP[rolePart]) {
        crew.push({
          role: CREW_ROLE_MAP[rolePart],
          crewId,
          name,
        });
      }
    }
  }
  return crew;
}

// ============================================
// Currency Parsing
// ============================================

function parseCurrencies(
  lines: string[],
  startIndex: number
): Omit<Currency, "id" | "createdAt" | "syncStatus">[] {
  const currencies: Omit<Currency, "id" | "createdAt" | "syncStatus">[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("Training") || line.startsWith("Memos")) break;

    const cols = parseCSVLine(line);
    const code = cols.find((c) => c && /^[A-Z]/.test(c));
    if (!code) continue;

    const description =
      cols.find(
        (c, idx) => idx > 0 && c.length > 2 && !/^\d{2}\/\d{2}\/\d{4}$/.test(c)
      ) || "";

    const dateCol = cols.find((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
    if (!dateCol) continue;

    currencies.push({
      code,
      description: description || code,
      expiryDate: parseDDMMYYYY(dateCol),
      warningDays: 30,
      criticalDays: 7,
      autoUpdate: true,
      lastUpdatedFrom: "schedule_csv",
    });
  }

  return currencies;
}

// ============================================
// Main Parser Function
// ============================================

export async function parseScheduleCSV(
  csvContent: string,
  options?: ParseOptions
): Promise<ScheduleImportResult> {
  const { onProgress, sourceFile } = options ?? {};
  //const lines = csvContent.split(/\r?\n/);

  //quickfix: todo refactor and name fix properly
  const rows: string[] = [];
  let currentRow = "";
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    if (char === '"') inQuotes = !inQuotes;

    // Only split on newlines that are OUTSIDE of quotes
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (currentRow.trim()) rows.push(currentRow);
      currentRow = "";
    } else {
      currentRow += char;
    }
  }
  if (currentRow.trim()) rows.push(currentRow);

  // Use 'rows' for the rest of your parsing loop
  const lines = rows;

  const result: ScheduleImportResult = {
    success: false,
    entriesCreated: 0,
    entriesUpdated: 0,
    entriesSkipped: 0,
    draftsCreated: 0,
    currenciesUpdated: 0,
    personnelCreated: 0,
    discrepancies: [],
    errors: [],
    warnings: [],
    timeReference: "UTC",
    dateRange: { start: "", end: "" },
    crewMember: { crewId: "", name: "", base: "", role: "", aircraftType: "" },
  };

  try {
    onProgress?.(5, "Parsing", "Reading CSV header...");

    const header = parseHeader(lines);
    result.timeReference = header.timeReference;
    result.dateRange = header.dateRange;
    result.crewMember = header.crewInfo;

    const { columnIndices, dataStartIndex } = header;

    onProgress?.(10, "Validating", "Checking user profile...");

    // Get current user
    const currentUser = await getCurrentUserPersonnel();
    if (!currentUser) {
      throw new Error(
        "No user profile found. Please create a crew member with 'This is me' enabled."
      );
    }

    onProgress?.(15, "Loading", "Fetching existing personnel...");

    // Load existing personnel for crew matching (same pattern as scoot-parser)
    const existingPersonnel = await getAllPersonnel();
    const crewCache = new Map<string, string>(); // name (lowercase) -> id
    existingPersonnel.forEach((p) => {
      crewCache.set(p.name.toLowerCase(), p.id);
      if (p.crewId) crewCache.set(p.crewId, p.id);
    });

    const entriesToSave: ScheduleEntry[] = [];
    const currenciesToSave: Omit<
      Currency,
      "id" | "createdAt" | "syncStatus"
    >[] = [];
    const personnelToCreate: Personnel[] = [];
    const flightsToCreate: FlightLog[] = [];
    const syncQueueEntries: any[] = [];

    onProgress?.(20, "Processing", "Parsing schedule entries...");

    // Parse schedule entries
    let processedRows = 0;
    const totalRows = lines.length - dataStartIndex;

    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i].trim();

      // Progress update
      processedRows++;
      if (processedRows % 10 === 0) {
        const percent = 20 + Math.floor((processedRows / totalRows) * 50);
        onProgress?.(
          percent,
          "Processing",
          `Row ${processedRows} of ~${totalRows}...`
        );
      }

      if (line.startsWith("Total Hours")) continue;
      if (line.startsWith("Expiry Dates")) {
        const expiryStart = lines.findIndex(
          (l, idx) => idx > i && l.includes("Code") && l.includes("Expiry")
        );
        if (expiryStart > 0) {
          currenciesToSave.push(...parseCurrencies(lines, expiryStart + 1));
        }
        continue;
      }
      if (
        line.startsWith("Training") ||
        line.startsWith("Memos") ||
        line.startsWith("Descriptions") ||
        line.startsWith("Generated")
      ) {
        continue;
      }
      if (!line || line.startsWith(",")) continue;

      const cols = parseCSVLine(line);
      const rawDate = cols[columnIndices.date] || "";
      const dateMatch = rawDate.match(/^(\d{2}\/\d{2}\/\d{4})/);
      if (!dateMatch) continue;

      const date = parseDDMMYYYY(dateMatch[1]);
      const duty = parseDutiesColumn(
        cols[columnIndices.duties] || "",
        cols[columnIndices.details] || ""
      );

      parseActualTimes(cols[columnIndices.actualTimes] || "", duty.sectors);

      // Parse crew (pilots only)
      const crew = parseCrewColumn(cols[columnIndices.crew] || "");

      // Link/create crew personnel (same logic as scoot-parser)
      for (const member of crew) {
        //const nameKey = member.name.toLowerCase(); used normalisedCsvName instead
        const normalizedCsvName = normalize(member.name);

        let personnelId =
          crewCache.get(normalizedCsvName) || crewCache.get(member.crewId);

        if (!personnelId) {
          const newPerson: Personnel = {
            id: crypto.randomUUID(),
            name: member.name,
            crewId: member.crewId,
            organization: "Scoot", //todo: logic to check organization, now is just assumed to be scoot since parse from scoot schedule
            roles: member.role === "FO" ? ["SIC"] : ["PIC"],
            isMe: false, // Ensure this doesn't match your own profile
            createdAt: Date.now(),
            syncStatus: "pending",
          };

          personnelToCreate.push(newPerson);
          crewCache.set(normalizedCsvName, newPerson.id);
          crewCache.set(member.crewId, newPerson.id);
          personnelId = newPerson.id;
        }
        member.personnelId = personnelId;
      }

      // ============================================
      // SMART FLIGHT MATCHING (when actual times exist)
      // ============================================
      for (const sector of duty.sectors) {
        if (sector.actualOut && sector.actualIn) {
          // Flight has actual times - try to match with existing flight
          const flightDate = date;
          const flightNumber = sector.flightNumber;

          // Query for existing flight by date and flight number
          const existingFlight = await userDb.flights
            .where("date")
            .equals(flightDate)
            .filter((f: FlightLog) => f.flightNumber === flightNumber)
            .first();

          if (existingFlight) {
            // Flight exists - compare times
            const timesMatch =
              existingFlight.outTime === sector.actualOut &&
              existingFlight.inTime === sector.actualIn;

            if (!timesMatch) {
              // Times differ - add to discrepancies for user review
              result.discrepancies.push({
                id: crypto.randomUUID(),
                type: "time_mismatch",
                severity: "info",
                flightLogId: existingFlight.id,
                field: "times",
                scheduleValue: `OUT: ${sector.actualOut}, IN: ${sector.actualIn}`,
                logbookValue: `OUT: ${existingFlight.outTime}, IN: ${existingFlight.inTime}`,
                message: `Flight ${flightNumber} times differ from schedule`,
                resolved: false,
                createdAt: Date.now(),
              });
            }

            // Link this sector to existing flight
            sector.linkedFlightId = existingFlight.id;
          } else {
            // Flight doesn't exist - create it with available data
            const depAirport = await getAirportByIata(sector.departureIata);
            const arrAirport = await getAirportByIata(sector.arrivalIata);
            const depOffset = depAirport
              ? getAirportTimeInfo(depAirport.tz).offset
              : 0;
            const arrOffset = arrAirport
              ? getAirportTimeInfo(arrAirport.tz).offset
              : 0;

            // Determine PIC from crew
            const picMember = crew.find(
              (c) => c.role === "CPT" || c.role === "PIC"
            );
            const isUserPic =
              picMember?.name.toLowerCase() === currentUser.name.toLowerCase();

            // Calculate block time from actual times
            const blockTime = calculateDuration(
              sector.actualOut,
              sector.actualIn
            );

            // Calculate night time if airports available
            const nightTimeResult =
              !depAirport || !arrAirport
                ? null
                : calculateNightTimeComplete(
                    flightDate,
                    sector.actualOut,
                    "", // offTime not available
                    "", // onTime not available
                    sector.actualIn,
                    { lat: depAirport.latitude, lon: depAirport.longitude },
                    { lat: arrAirport.latitude, lon: arrAirport.longitude }
                  );
            const nightTime = nightTimeResult?.nightTimeHHMM ?? "00:00";

            const newFlight: FlightLog = {
              id: crypto.randomUUID(),
              isDraft: false, // Actual times = confirmed flight
              date: flightDate,
              flightNumber: flightNumber,
              aircraftReg: "", // Not in schedule
              aircraftType: sector.aircraftType,
              departureIata: sector.departureIata,
              departureIcao: depAirport?.icao || "",
              arrivalIata: sector.arrivalIata,
              arrivalIcao: arrAirport?.icao || "",
              departureTimezone: depOffset,
              arrivalTimezone: arrOffset,
              scheduledOut: sector.scheduledOut || "",
              scheduledIn: sector.scheduledIn || "",
              outTime: sector.actualOut,
              offTime: "",
              onTime: "",
              inTime: sector.actualIn,
              blockTime: blockTime,
              flightTime: blockTime, // Use block time as flight time estimate
              nightTime: nightTime,
              dayTime: minutesToHHMM(
                Math.max(0, hhmmToMinutes(blockTime) - hhmmToMinutes(nightTime))
              ),
              picId: isUserPic ? currentUser.id : picMember?.personnelId || "",
              picName: isUserPic ? currentUser.name : picMember?.name || "",
              sicId: !isUserPic ? currentUser.id : "",
              sicName: !isUserPic ? currentUser.name : "",
              additionalCrew: [],
              pilotFlying: true,
              pilotRole: isUserPic ? "PIC" : "SIC",
              picTime: isUserPic ? blockTime : "00:00",
              sicTime: !isUserPic ? blockTime : "00:00",
              picusTime: "00:00",
              dualTime: "00:00",
              instructorTime: "00:00",
              dayTakeoffs: 0,
              dayLandings: 0,
              nightTakeoffs: 0,
              nightLandings: 0,
              autolands: 0,
              remarks: `Imported from schedule: ${flightNumber}`,
              endorsements: "",
              manualOverrides: {},
              ifrTime: "00:00",
              actualInstrumentTime: "00:00",
              simulatedInstrumentTime: "00:00",
              crossCountryTime: "00:00",
              approaches: [],
              holds: 0,
              ipcIcc: false,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              syncStatus: "pending",
            };

            flightsToCreate.push(newFlight);
            sector.linkedFlightId = newFlight.id;
            result.draftsCreated++; // Using this counter for created flights

            syncQueueEntries.push({
              id: crypto.randomUUID(),
              type: "create",
              collection: "flights",
              data: newFlight,
              timestamp: Date.now(),
            });
          }
        }
      }

      const entry: ScheduleEntry = {
        id: crypto.randomUUID(),
        date,
        timeReference: header.timeReference,
        reportTime:
          cols[columnIndices.reportTimes]?.replace(/[^\d:]/g, "") || undefined,
        debriefTime:
          cols[columnIndices.debriefTimes]?.replace(/[⁺¹]/g, "").trim() ||
          undefined,
        dutyType: duty.dutyType,
        dutyCode: duty.dutyCode,
        dutyDescription:
          duty.dutyDescription || cols[columnIndices.details]?.trim(),
        sectors: duty.sectors,
        crew, // Now only contains pilots
        indicators: cols[columnIndices.indicators]?.trim()
          ? [cols[columnIndices.indicators].trim()]
          : undefined,
        sourceFile,
        linkedFlightIds: duty.sectors
          .filter((s) => s.linkedFlightId)
          .map((s) => s.linkedFlightId as string),
        importedAt: Date.now(),
        createdAt: Date.now(),
        syncStatus: "pending",
      };

      entriesToSave.push(entry);
    }

    onProgress?.(75, "Saving", "Writing to database...");

    // Save to database in transaction
    await userDb.transaction(
      "rw",
      [
        userDb.scheduleEntries,
        userDb.currencies,
        userDb.personnel,
        userDb.flights,
        userDb.syncQueue,
      ],
      async () => {
        // Create personnel
        if (personnelToCreate.length > 0) {
          await userDb.personnel.bulkAdd(personnelToCreate);
          result.personnelCreated = personnelToCreate.length;
        }

        // Create flights (from actual times)
        if (flightsToCreate.length > 0) {
          await userDb.flights.bulkAdd(flightsToCreate);
        }

        // Upsert schedule entries
        for (const entry of entriesToSave) {
          const existing = await userDb.scheduleEntries
            .where("date")
            .equals(entry.date)
            .filter((e: ScheduleEntry) => e.dutyCode === entry.dutyCode)
            .first();

          if (existing) {
            await userDb.scheduleEntries.update(existing.id, {
              ...entry,
              id: existing.id,
              updatedAt: Date.now(),
            });
            result.entriesUpdated++;
          } else {
            await userDb.scheduleEntries.add(entry);
            result.entriesCreated++;
          }
        }

        // Upsert currencies
        for (const currency of currenciesToSave) {
          const existing = await userDb.currencies
            .where("code")
            .equals(currency.code)
            .first();

          if (existing) {
            if (existing.autoUpdate) {
              await userDb.currencies.update(existing.id, {
                expiryDate: currency.expiryDate,
                description: currency.description,
                lastUpdatedFrom: "schedule_csv",
                updatedAt: Date.now(),
              });
              result.currenciesUpdated++;
            }
          } else {
            await userDb.currencies.add({
              ...currency,
              id: crypto.randomUUID(),
              createdAt: Date.now(),
              syncStatus: "pending",
            });
            result.currenciesUpdated++;
          }
        }

        // Add sync queue entries
        if (syncQueueEntries.length > 0) {
          await userDb.syncQueue.bulkAdd(syncQueueEntries);
        }
      }
    );

    onProgress?.(100, "Complete", `Imported ${result.entriesCreated} entries`);

    result.success = true;

    console.log(
      `[Schedule Parser] Imported ${result.entriesCreated} entries, ${result.entriesUpdated} updated, ${result.draftsCreated} flights created, ${result.personnelCreated} crew`
    );
  } catch (error) {
    result.errors.push({
      line: 0,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    console.error("[Schedule Parser] Error:", error);
  }

  return result;
}

/**
 * Detect CSV type (schedule vs logbook)
 */
export function detectCSVType(
  csvContent: string
): "schedule" | "logbook" | "unknown" {
  const firstLines = csvContent.split(/\r?\n/).slice(0, 10).join("\n");
  if (firstLines.includes("Personal Crew Schedule Report")) return "schedule";
  if (firstLines.includes("Crew Logbook Report")) return "logbook";
  return "unknown";
}
