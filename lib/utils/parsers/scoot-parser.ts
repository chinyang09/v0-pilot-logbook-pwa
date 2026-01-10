import {
  userDb as db,
  type FlightLog,
  type Personnel,
  getCurrentUserPersonnel,
  getAirportByIata,
  getAirportTimeInfo,
  getAircraftByRegistrationFromDB,
} from "@/lib/db"
import { calculateNightTimeComplete } from "@/lib/utils/night-time"
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time"

export async function processScootCSV(csvContent: string) {
  const currentUser = await getCurrentUserPersonnel()
  if (!currentUser) {
    throw new Error("No user profile found. Please create a crew member with 'This is me' enabled in the Crew page.")
  }
  const currentUserId = currentUser.id
  const currentUserName = currentUser.name

  const lines = csvContent.split(/\r?\n/)
  const dataStartIndex = lines.findIndex((l) => l.includes("Date,Airport,Time")) + 1
  if (dataStartIndex === 0) throw new Error("Invalid CSV Format")

  const crewCache = new Map<string, string>()
  const existingCrew = await db.personnel.toArray()
  existingCrew.forEach((p) => crewCache.set(p.name.toLowerCase(), p.id))

  const flightsToSave: FlightLog[] = []
  const personnelToSave: Personnel[] = []
  const syncQueueEntries: any[] = []

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith("Totals") || line.startsWith(",")) continue

    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
    const rawDate = cols[0]?.replace(/"/g, "").trim()
    const dateRegex = /^\d{2}\/\d{2}\/\d{2}$/
    const depIata = cols[1]?.replace(/"/g, "").trim().toUpperCase()

    if (!dateRegex.test(rawDate) || !depIata || depIata.length !== 3) continue

    const arrIata = cols[3]?.replace(/"/g, "").trim().toUpperCase()
    const depAp = await getAirportByIata(depIata)
    const arrAp = await getAirportByIata(arrIata)
    const rawReg = cols[6]?.replace(/"/g, "").trim()

    const matchedAc = await getAircraftByRegistrationFromDB(rawReg)

    const outT = cols[2]?.trim()
    const inT = cols[4]?.trim()
    const blockT = cols[7]?.trim()
    const isSim = cols[17]?.toUpperCase().includes("SIM") || cols[5]?.toUpperCase().includes("SIM")

    const dateParts = rawDate.split("/")
    const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2]
    const flightDate = `${year}-${dateParts[1].toString().padStart(2, "0")}-${dateParts[0].toString().padStart(2, "0")}`

    // Crew Logic
    const rawPicName = cols[8]?.replace(/"/g, "").trim()
    let picId = "",
      picName = "",
      sicId = "",
      sicName = ""
    const isUserPic = rawPicName?.toLowerCase() === currentUserName.toLowerCase()

    if (isUserPic) {
      picId = currentUserId
      picName = currentUserName
    } else {
      sicId = currentUserId
      sicName = currentUserName
      picName = rawPicName
      if (picName && !crewCache.has(picName.toLowerCase())) {
        const newPerson: Personnel = {
          id: crypto.randomUUID(),
          name: picName,
          createdAt: Date.now(),
          syncStatus: "pending",
          isMe: false,
          roles: ["PIC"],
        }
        personnelToSave.push(newPerson)
        crewCache.set(picName.toLowerCase(), newPerson.id)
        syncQueueEntries.push({
          id: crypto.randomUUID(),
          type: "create",
          collection: "personnel",
          data: newPerson,
          timestamp: Date.now(),
        })
      }
      picId = crewCache.get(picName.toLowerCase()) || ""
    }

    const depOffset = depAp ? getAirportTimeInfo(depAp.tz).offset : 0
    const arrOffset = arrAp ? getAirportTimeInfo(arrAp.tz).offset : 0

    const nightT =
      !isSim && depAp && arrAp
        ? calculateNightTimeComplete(
            flightDate,
            outT,
            "",
            "",
            inT,
            { lat: depAp.latitude, lon: depAp.longitude },
            { lat: arrAp.latitude, lon: arrAp.longitude },
          )
        : "00:00"

    const flight: FlightLog = {
      id: crypto.randomUUID(),
      isDraft: false,
      date: flightDate,
      flightNumber: "",
      aircraftReg: matchedAc?.registration || rawReg,
      aircraftType: (matchedAc as any)?.typecode || cols[5] || "",
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
      dayTime: minutesToHHMM(Math.max(0, hhmmToMinutes(blockT || "00:00") - hhmmToMinutes(nightT))),
      picId: picId,
      picName: picName,
      sicId: sicId,
      sicName: sicName,
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
    }

    flightsToSave.push(flight)
    syncQueueEntries.push({
      id: crypto.randomUUID(),
      type: "create",
      collection: "flights",
      data: flight,
      timestamp: Date.now(),
    })
  }

  await db.transaction("rw", [db.flights, db.personnel, db.syncQueue], async () => {
    if (personnelToSave.length > 0) await db.personnel.bulkAdd(personnelToSave)
    if (flightsToSave.length > 0) await db.flights.bulkAdd(flightsToSave)
    if (syncQueueEntries.length > 0) await db.syncQueue.bulkAdd(syncQueueEntries)
  })

  console.log(`Successfully processed ${flightsToSave.length} flights.`)
}
