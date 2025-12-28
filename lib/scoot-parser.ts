import { db, type FlightLog, type Personnel } from "./indexed-db";
import { calculateNightTimeComplete } from "./night-time-calculator";
import { hhmmToMinutes, minutesToHHMM } from "./time-utils";
import { getAirportByIATA, type AirportData } from "./airport-database";
import {
  getAircraftByRegistrationFromDB,
  type AircraftData,
} from "./aircraft-database";

export async function processScootCSV(
  csvContent: string,
  airports: AirportData[],
  aircraftDb: AircraftData[],
  currentUserId: string,
  currentUserName: string
) {
  const lines = csvContent.split(/\r?\n/);
  let dataStartIndex =
    lines.findIndex((l) => l.includes("Date,Airport,Time")) + 1;
  if (dataStartIndex === 0) throw new Error("Invalid CSV Format");

  const crewCache = new Map<string, string>();
  const existingCrew = await db.personnel.toArray();
  existingCrew.forEach((p) => crewCache.set(p.name.toLowerCase(), p.id));

  // Containers for bulk operations
  const flightsToSave: FlightLog[] = [];
  const personnelToSave: Personnel[] = [];
  const syncQueueEntries: any[] = [];

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("Totals") || line.startsWith(",")) continue;

    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const rawDate = cols[0]?.replace(/"/g, "").trim();
    const dateRegex = /^\d{2}\/\d{2}\/\d{2}$/;
    const depIata = cols[1]?.replace(/"/g, "").trim().toUpperCase();

    if (!dateRegex.test(rawDate) || !depIata || depIata.length !== 3) continue;

    const arrIata = cols[3]?.replace(/"/g, "").trim().toUpperCase();
    const depAp = getAirportByIATA(airports, depIata);
    const arrAp = getAirportByIATA(airports, arrIata);
    const rawReg = cols[6]?.replace(/"/g, "").trim();

    // Aircraft lookup (Awaited per row, or pre-cache if aircraftDb is large)
    const matchedAc = await getAircraftByRegistrationFromDB(rawReg);

    const outT = cols[2]?.trim();
    const inT = cols[4]?.trim();
    const blockT = cols[7]?.trim();
    const isSim =
      cols[17]?.toUpperCase().includes("SIM") ||
      cols[5]?.toUpperCase().includes("SIM");

    const dateParts = rawDate.split("/");
    const flightDate = `${dateParts[2]}-${dateParts[1]
      .toString()
      .padStart(2, "0")}-${dateParts[0].toString().padStart(2, "0")}`;

    // Crew Logic
    const rawPicName = cols[8]?.replace(/"/g, "").trim();
    let picId = "",
      picName = "",
      sicId = "",
      sicName = "";
    const isUserPic =
      rawPicName?.toLowerCase() === currentUserName.toLowerCase();

    if (isUserPic) {
      picId = currentUserId;
      picName = currentUserName;
    } else {
      sicId = currentUserId;
      sicName = currentUserName;
      picName = rawPicName;
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

        // Add to sync queue batch
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
      flightNumber: "", // Scoot CSV doesn't explicitly provide this in standard cols
      aircraftReg: matchedAc?.registration || rawReg,
      aircraftType: matchedAc?.typecode || cols[5],
      departureIata: depIata,
      departureIcao: depAp?.icao || "",
      arrivalIata: arrIata,
      arrivalIcao: arrAp?.icao || "",
      departureTimezone: depAp?.timezone ? parseFloat(depAp.timezone) : 0,
      arrivalTimezone: arrAp?.timezone ? parseFloat(arrAp.timezone) : 0,
      outTime: outT,
      inTime: inT,
      blockTime: blockT,
      flightTime: isSim ? "00:00" : blockT,
      nightTime: nightT,
      dayTime: minutesToHHMM(
        Math.max(0, hhmmToMinutes(blockT) - hhmmToMinutes(nightT))
      ),
      picId: picId,
      picName: picName,
      sicId: sicId,
      sicName: sicName,
      pilotRole: isUserPic ? "PIC" : "SIC",
      picTime: isUserPic ? blockT : "00:00",
      sicTime: !isUserPic ? blockT : "00:00",
      simulatedInstrumentTime: isSim ? blockT : "00:00",
      dayTakeoffs: parseInt(cols[9]) || 0,
      nightTakeoffs: parseInt(cols[10]) || 0,
      dayLandings: parseInt(cols[11]) || 0,
      nightLandings: parseInt(cols[12]) || 0,
      remarks: cols[17]?.trim() || "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncStatus: "pending",
      additionalCrew: [],
      approaches: [],
      pilotFlying: true,
      picusTime: "00:00",
      dualTime: "00:00",
      instructorTime: "00:00",
      autolands: 0,
      ifrTime: "00:00",
      actualInstrumentTime: "00:00",
      crossCountryTime: "00:00",
      holds: 0,
      ipcIcc: false,
      manualOverrides: {},
      endorsements: "",
    } as any;

    flightsToSave.push(flight);

    // Add to sync queue batch
    syncQueueEntries.push({
      id: crypto.randomUUID(),
      type: "create",
      collection: "flights",
      data: flight,
      timestamp: Date.now(),
    });
  }

  // Final Bulk Database Operations
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

  console.log(`Successfully processed ${flightsToSave.length} flights.`);
}
