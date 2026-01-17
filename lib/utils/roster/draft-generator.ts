/**
 * Draft Flight Generator
 * Creates draft FlightLog entries from schedule data
 */

import type {
  ScheduleEntry,
  ScheduledSector,
  DraftGenerationConfig,
} from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"
import {
  userDb,
  getAirportByIata,
  getAirportTimeInfo,
  getCurrentUserPersonnel,
  linkFlightsToScheduleEntry,
  addFlight,
} from "@/lib/db"
import { calculateNightTimeComplete } from "@/lib/utils/night-time"
import { calculateDuration, hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time"

export const DEFAULT_DRAFT_CONFIG: DraftGenerationConfig = {
  triggerMode: "day_of",
  hoursBeforeReport: 2,
  autoPopulate: {
    crew: true,
    scheduledTimes: true,
    actualTimes: true,
    flightNumber: true,
    aircraftType: true,
  },
}

/**
 * Check if drafts should be created for a schedule entry
 */
export function shouldCreateDrafts(
  entry: ScheduleEntry,
  config: DraftGenerationConfig = DEFAULT_DRAFT_CONFIG,
  referenceDate: Date = new Date()
): boolean {
  if (entry.dutyType !== "flight" || entry.sectors.length === 0) return false
  if (entry.linkedFlightIds && entry.linkedFlightIds.length > 0) return false

  const flightDate = new Date(entry.date + "T00:00:00Z")

  switch (config.triggerMode) {
    case "day_before": {
      const dayBefore = new Date(flightDate)
      dayBefore.setDate(dayBefore.getDate() - 1)
      dayBefore.setHours(18, 0, 0, 0)
      return referenceDate >= dayBefore
    }
    case "day_of": {
      const startOfDay = new Date(flightDate)
      startOfDay.setHours(0, 0, 0, 0)
      return referenceDate >= startOfDay
    }
    case "report_time": {
      if (!entry.reportTime) return false
      const [hh, mm] = entry.reportTime.split(":").map(Number)
      const reportDateTime = new Date(flightDate)
      reportDateTime.setUTCHours(hh, mm, 0, 0)
      const triggerTime = new Date(
        reportDateTime.getTime() - config.hoursBeforeReport * 60 * 60 * 1000
      )
      return referenceDate >= triggerTime
    }
    case "manual":
      return false
    default:
      return false
  }
}

/**
 * Create draft flights from a schedule entry
 */
export async function createDraftsFromScheduleEntry(
  entry: ScheduleEntry,
  config: DraftGenerationConfig = DEFAULT_DRAFT_CONFIG
): Promise<FlightLog[]> {
  const currentUser = await getCurrentUserPersonnel()
  if (!currentUser) {
    throw new Error("No user profile found")
  }

  const drafts: FlightLog[] = []

  for (const sector of entry.sectors) {
    // Skip if already linked to a flight
    if (sector.linkedFlightId) {
      continue
    }

    const depAirport = await getAirportByIata(sector.departureIata)
    const arrAirport = await getAirportByIata(sector.arrivalIata)

    const depOffset = depAirport ? getAirportTimeInfo(depAirport.tz).offset : 0
    const arrOffset = arrAirport ? getAirportTimeInfo(arrAirport.tz).offset : 0

    // Determine PIC from crew
    const picMember = entry.crew.find((c) => c.role === "CPT" || c.role === "PIC")
    const isUserPic = currentUser.crewId
      ? picMember?.crewId === currentUser.crewId
      : picMember?.name.toLowerCase() === currentUser.name.toLowerCase()

    // Calculate estimated block time if we have scheduled times
    let estimatedBlockTime = "00:00"
    if (sector.scheduledOut && sector.scheduledIn) {
      estimatedBlockTime = calculateDuration(sector.scheduledOut, sector.scheduledIn)
    }

    const draft: FlightLog = {
      id: crypto.randomUUID(),
      isDraft: true,
      date: entry.date,
      flightNumber: config.autoPopulate.flightNumber ? sector.flightNumber : "",
      aircraftReg: "",
      aircraftType: config.autoPopulate.aircraftType ? sector.aircraftType : "",
      departureIata: sector.departureIata,
      departureIcao: depAirport?.icao || "",
      arrivalIata: sector.arrivalIata,
      arrivalIcao: arrAirport?.icao || "",
      departureTimezone: depOffset,
      arrivalTimezone: arrOffset,
      scheduledOut: config.autoPopulate.scheduledTimes ? sector.scheduledOut : "",
      scheduledIn: config.autoPopulate.scheduledTimes ? sector.scheduledIn : "",
      outTime: config.autoPopulate.actualTimes ? sector.actualOut || "" : "",
      offTime: "",
      onTime: "",
      inTime: config.autoPopulate.actualTimes ? sector.actualIn || "" : "",
      blockTime: estimatedBlockTime,
      flightTime: "00:00",
      nightTime: "00:00",
      dayTime: "00:00",
      picId: config.autoPopulate.crew && isUserPic ? currentUser.id : config.autoPopulate.crew ? picMember?.personnelId || "" : "",
      picName: config.autoPopulate.crew && isUserPic ? currentUser.name : config.autoPopulate.crew ? picMember?.name || "" : "",
      sicId: config.autoPopulate.crew && !isUserPic ? currentUser.id : "",
      sicName: config.autoPopulate.crew && !isUserPic ? currentUser.name : "",
      additionalCrew: [],
      pilotFlying: true,
      pilotRole: isUserPic ? "PIC" : "SIC",
      picTime: "00:00",
      sicTime: "00:00",
      picusTime: "00:00",
      dualTime: "00:00",
      instructorTime: "00:00",
      dayTakeoffs: 0,
      dayLandings: 0,
      nightTakeoffs: 0,
      nightLandings: 0,
      autolands: 0,
      remarks: `Draft from schedule: ${sector.flightNumber || `${sector.departureIata}-${sector.arrivalIata}`}`,
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
    }

    drafts.push(draft)
  }

  // Save drafts using the addFlight function which handles sync queue
  const savedDrafts: FlightLog[] = []
  for (const draft of drafts) {
    const saved = await addFlight(draft)
    savedDrafts.push(saved)
  }

  // Link drafts to schedule entry
  if (savedDrafts.length > 0) {
    await linkFlightsToScheduleEntry(
      entry.id,
      savedDrafts.map((d) => d.id)
    )
  }

  return savedDrafts
}

/**
 * Process all pending schedule entries for draft generation
 */
export async function processPendingDrafts(
  config: DraftGenerationConfig = DEFAULT_DRAFT_CONFIG
): Promise<{ created: number; entriesProcessed: string[] }> {
  const result = { created: 0, entriesProcessed: [] as string[] }

  const entries = await userDb.scheduleEntries
    .where("dutyType")
    .equals("flight")
    .filter((e) => !e.linkedFlightIds || e.linkedFlightIds.length === 0)
    .toArray()

  for (const entry of entries) {
    if (shouldCreateDrafts(entry, config)) {
      try {
        const drafts = await createDraftsFromScheduleEntry(entry, config)
        result.created += drafts.length
        result.entriesProcessed.push(entry.id)
      } catch (error) {
        console.error(`Failed to create drafts for entry ${entry.id}:`, error)
      }
    }
  }

  return result
}
