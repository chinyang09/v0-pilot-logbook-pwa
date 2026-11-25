/**
 * The company's briefing packages for TR438 WSSS–WBGG (22 Nov 26) and TR439
 * WBGG–WSSS (23 Nov 26), read by the REAL extractor (`pdfToPages`, pinned as
 * the pages it gave — `fixtures/*.pages.json`, the dispatcher's number
 * blanked) and the parser. The journal figures are the owner's own Flying
 * Journal for the same two flights — what they copied off these PDFs by hand.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { isBriefingPackage, notamKey, parseBriefing, readRoute, splitSections } from "../parse"
import { firCrossings, journalOf } from "../journal"

const pages = (name: string): string[][] => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.pages.json`), "utf8"))
const out = pages("tr438-wsss-wbgg")
const back = pages("tr439-wbgg-wsss")
/** TR552 WSSS–VVTS (25 Nov 26): a route too long for one line of the print. */
const wrapped = pages("tr552-wsss-vvts")

describe("the package's sections", () => {
  it("are found by their titles, the OFP printed twice", () => {
    const titles = splitSections(out).map((s) => s.title)
    expect(titles.filter((t) => t === "OFP")).toHaveLength(2)
    for (const t of ["OPTIFLIGHT BRIEFING", "Additional Info", "Airport WX List", "NOTAM", "INTAM"]) expect(titles).toContain(t)
  })
  it("is recognised as a briefing package", () => {
    expect(isBriefingPackage(out)).toBe(true)
    expect(isBriefingPackage([["Personal Crew Schedule Report"]])).toBe(false)
  })
})

describe("TR438 WSSS–WBGG", () => {
  const b = parseBriefing(out)

  it("names the flight", () => {
    expect(b.flight).toMatchObject({
      number: "TR438",
      callsign: "TGW438",
      date: "2026-11-22",
      dep: "WSSS",
      arr: "WBGG",
      depIata: "SIN",
      arrIata: "KCH",
      registration: "9V-TNG",
      aircraftType: "A320-271N",
      ofpVersion: "4",
      routeNumber: "SINKCH01",
      arrUtcOffsetMinutes: 480,
    })
  })

  it("reads the route", () => {
    expect(b.route).toMatchObject({
      text: "WSSS/02C DODSO G580 ATETI DCT MOXUN MOXUN1A WBGG/25",
      atc: "N0450F290 DODSO G580 ATETI DCT MOXUN MOXUN1A",
      depRunway: "02C",
      arrRunway: "25",
      cruiseFl: 290,
      costIndex: 20,
      groundNm: 423,
      airNm: 433,
      avgWindKt: -10,
      schedDep: "22:30",
      schedArr: "00:05",
    })
    expect(b.sid).toMatchObject({ name: "DODSO1A", runway: "02C", totalNm: 142 })
    expect(b.sid!.waypoints.map((w) => w.name)).toEqual(["MOXIB", "EMRIX", "HOSBA", "VEBMA", "TOMAN", "DODSO"])
    expect(b.star).toMatchObject({ name: "MOXUN1A", runway: "25", totalNm: 65 })
  })

  it("fills the journal card as the owner wrote it", () => {
    const j = journalOf(b)
    expect(j).toMatchObject({ registration: "9V-TNG", off: "22:30", on: "00:05", block: "1:35", flight: "1:07" })
    expect(j.initA).toEqual({
      altn: "WSSS",
      toIata: "KCH",
      toIcao: "WBGG",
      flightNumber: "TR438",
      timeZone: "UTC+8",
      distNm: 423,
      tropo: 547,
      crzFl: 290,
      crzTemp: -26,
    })
    // The owner's card has TRIP 200 / RTE RSV 2566 and ALTN 200 / FINAL 2396 —
    // the rows slipped by one when copied. The OFP's own figures (MDF 3159 =
    // 2396 + 763 agrees with the card):
    expect(j.initB).toEqual({
      taxi: 200,
      trip: 2566,
      rteRsv: 200,
      altn: 2396,
      final: 763,
      mdf: 3159,
      zfw: { planned: 54877, max: 64300 },
      block: 6125,
      tow: { planned: 60802, max: 79000 },
      lw: { planned: 58236, max: 67400 },
      avgWindKt: -10,
    })
    expect(j.optiClimb).toEqual([
      { ias: 244, fl: 154 },
      { ias: 279, fl: 290 },
    ])
    expect([j.extra, j.topup60, j.additional]).toEqual([0, 0, 0])
  })

  it("reads the alternates with their routes", () => {
    expect(b.alternates.map((a) => [a.icao, a.runway, a.approach, a.minima, a.distNm, a.fuelKg])).toEqual([
      ["WSSS", "02L", "CAT1DME", "200FT/550M", 407, 2396],
      ["WBSB", "21", "LOCDME", "312FT/1000M", 367, 2265],
      ["WIDD", "22", "VORDME", "573FT/2700M", 457, 2684],
      ["WBKK", "20", "RNAV GPS", "630FT/2400M", 474, 2737],
    ])
    // Carried on to the next page.
    expect(b.alternates[3].route).toBe("WBGG KIKAK1C KIKAK DCT PILAX G580 SARVO DCT BRU G460 VLB DCT SUKUS SUKUS1A")
  })

  it("reads the RTOW", () => {
    expect(b.rtow).toMatchObject({ airport: "WSSS", runway: "02C", flaps: "2", limit: "Obstacle", rtowKg: 69966, perfKg: 82608 })
  })

  it("reads the nav log as positions, with the FIR boundaries", () => {
    expect(b.navlog).toHaveLength(23)
    const toman = b.navlog.find((p) => p.name === "TOMAN")!
    expect(toman).toMatchObject({ elapsedMin: 18, level: "290", msaFt: 2300, legNm: 24, wind: "09014", isaDev: 16, groundSpeedKt: 438, toGoNm: 307, fuelRemainingKg: 4700 })
    expect(toman.lat).toBeCloseTo(1 + 21.8 / 60, 4)
    expect(toman.lon).toBeCloseTo(105 + 47.3 / 60, 4)
    // The last point has no level and no wind column.
    expect(b.navlog.at(-1)).toMatchObject({ name: "WBGG", elapsedMin: 67, toGoNm: 0, fuelRemainingKg: 3400 })
    // Each boundary with the first named point after it (TOC / TOD are not points to call at).
    expect(firCrossings(b).map((f) => `${f.fir}@${f.wp}`)).toEqual([
      "WMFC@MOXIB",
      "WSJC@HOSBA",
      "WIIF@VEBMA",
      "WSJC@VEBMA",
      "WBFC@ATETI",
      "WIIF@MOXUN",
      "WBFC@OVKES",
    ])
  })

  it("reads the weather list's airports by role, without their reports", () => {
    const wbgg = b.stations.find((s) => s.icao === "WBGG")!
    expect(wbgg).toEqual({ icao: "WBGG", iata: "KCH", name: expect.any(String), role: "destination" })
    expect(b.stations.filter((s) => s.role === "alternate").map((s) => s.icao)).toEqual(["WBSB", "WIDD", "WBKK"])
    expect(b.stations.find((s) => s.icao === "WSSS")!.role).toBe("departure")
  })

  it("reads EVERY NOTAM in the bulletin", () => {
    const items = b.notams.items
    // 70 "VALID:" entries in the PDF.
    expect(items).toHaveLength(70)
    expect(b.notams.validFromMs).toBe(Date.UTC(2026, 10, 22, 22, 30))
    expect(new Set(items.map((n) => n.section))).toEqual(
      new Set([
        "Departure Airport",
        "Destination Airport",
        "Destination Alternate(s)",
        "Enroute Airport(s)",
        "Extended Area Around Departure",
        "Area Enroute Departure - Destination",
        "Area Enroute Destination - Destination Alternate(s)",
        "Extended Area Around Destination Alternate Airport(s)",
      ]),
    )
    const s2 = items.find((n) => n.id === "1A3350/26")!
    expect(s2).toMatchObject({ location: "WSSS", category: "AIRPORT", text: "TWY S2 CLSD", toMs: Date.UTC(2026, 11, 31, 15, 59) })
    const perm = items.find((n) => n.id === "SX174/26")!
    expect([perm.toMs, perm.toText]).toEqual([null, "PERM"])
    // A schedule carried over two lines is the schedule, not the text.
    const n2 = items.find((n) => n.id === "1A3541/26")!
    expect(n2.schedule).toBe("NOV 21-30 0030-0130 0400-0500 0730-0830 1130-1230, DEC 01-04 0030-0130 0400-0500 0730-0830 1130-1230")
    expect(n2.text).toBe("TWY N2 BEHIND ACFT STAND 504 CLSD.")
    expect(items.find((n) => n.id === "1A3730/26")!.schedule).toBe("DAILY 1010-1025 2300-2345")
    // Vertical limits from F) and G) on one line — not two list items.
    expect(items.find((n) => n.id === "1A3496/26")!.limits).toBe("SFC – FL400")
    expect(items.find((n) => n.id === "SX35/26")!.limits).toBe("")
    // The area NOTAMs keep their area.
    expect(items.find((n) => n.id === "1A4146/26")).toMatchObject({ location: "WSJC", locationName: "Singapore Fir" })
    expect(items.find((n) => n.id === "1A4600/26")!.location).toBe("D8/CHINA SEA NORTH RANGE")
    // The bulletin's own duplicate mark.
    expect(items.filter((n) => n.duplicate).map((n) => n.id)).toEqual(["1A4401/26"])
  })

  it("reads the INTAMs", () => {
    expect(b.intams.map((i) => [i.id, i.title, i.auth])).toEqual([
      ["26063", "TIMELY ENGINEERING RECTIFICATION OF AUDIO CONTROL PANEL (ACP)ISSUES", "CP A320"],
      ["26071", "AWARENESS OF GROUND ENVIRONMENT DURING TAXI", "CP A320"],
      ["26090", "TAIL STRIKE PREVENTION (ISSUED 23 OCT 26)", "CP A320"],
    ])
    expect(b.intams[2].body).toContain("THE PM CALLS \"PITCH\"")
  })
})

describe("TR439 WBGG–WSSS", () => {
  const b = parseBriefing(back)

  it("fills the journal card exactly as the owner wrote it", () => {
    const j = journalOf(b)
    expect(j).toMatchObject({ off: "01:05", on: "02:40", block: "1:35", flight: "1:02" })
    expect(j.initA).toEqual({
      altn: "WSAP",
      toIata: "SIN",
      toIcao: "WSSS",
      flightNumber: "TR439",
      timeZone: "UTC+8",
      distNm: 407,
      tropo: 545,
      crzFl: 300,
      crzTemp: -28,
    })
    expect(j.initB).toEqual({
      taxi: 200,
      trip: 2289,
      rteRsv: 200,
      altn: 784,
      final: 732,
      mdf: 1516,
      zfw: { planned: 52759, max: 64300 },
      block: 4205,
      tow: { planned: 56764, max: 79000 },
      lw: { planned: 54475, max: 67400 },
      avgWindKt: 10,
    })
    expect(j.optiClimb).toEqual([
      { ias: 248, fl: 128 },
      { ias: 269, fl: 300 },
    ])
  })

  it("reads its SID, STAR, RTOW and every NOTAM", () => {
    expect(b.sid).toMatchObject({ name: "MOXUN1D", runway: "25" })
    expect(b.star).toMatchObject({ name: "KARTO2A", runway: "02L" })
    expect(b.rtow).toMatchObject({ airport: "WBGG", runway: "25", rtowKg: 69689 })
    expect(b.notams.items).toHaveLength(54)
  })

  it("knows a NOTAM it met on the way out by its words, whatever the section", () => {
    const outKeys = new Set(parseBriefing(out).notams.items.map((n) => n.key))
    const s2 = b.notams.items.find((n) => n.id === "1A3350/26")!
    expect(s2.section).toBe("Destination Airport")
    expect(outKeys.has(s2.key)).toBe(true)
  })
})

describe("TR552 WSSS–VVTS — the route wraps onto a second line", () => {
  const b = parseBriefing(wrapped)

  it("is a briefing package, and its flight is read", () => {
    // It was refused: the route ran onto a second line, so the departure
    // and arrival came back blank ("the OFP's flight could not be read").
    expect(isBriefingPackage(wrapped.slice(0, 4))).toBe(true)
    expect(b.flight).toMatchObject({ number: "TR552", date: "2026-11-25", dep: "WSSS", arr: "VVTS", depIata: "SIN", arrIata: "SGN", registration: "9V-NCM" })
  })

  it("joins the route across the lines it wraps onto", () => {
    expect(b.route).toMatchObject({
      text: "WSSS/02C VMR L642 ROBMO L642 EGOLO DCT IPRIX M753 BITOD L637 ANBOV ANBOV5E VVTS/07L",
      depRunway: "02C",
      arrRunway: "07L",
      cruiseFl: 260,
    })
    expect(b.sid).toMatchObject({ name: "VMR6A", runway: "02C" })
    expect(b.star).toMatchObject({ name: "ANBOV5E", runway: "07L" })
  })

  it("reads the rest of the package as the one-line routes", () => {
    expect(b.alternates.map((a) => a.icao)).toEqual(["VVPQ", "VVCR", "VVDN"])
    expect(journalOf(b).initB).toMatchObject({ trip: 4166, altn: 1519, final: 999, block: 7092 })
    expect(b.notams.items).toHaveLength(70)
  })

  it("does not take an alternate's line, or a line that never closes, for the route", () => {
    expect(readRoute(["VVPQ/28R  RNAV GPS   993FT/2400M  0183  160 P009  0036 01519"])).toBeNull()
    expect(readRoute(["WSSS/02C VMR L642", "SCHED DEP 0530 UTC      SCHED ARR 0745 UTC", "VVTS/07L"])).toBeNull()
    expect(readRoute(["WSSS/02C DODSO G580 ATETI DCT MOXUN MOXUN1A WBGG/25"])?.[4]).toBe("WBGG")
  })
})

describe("a NOTAM's key", () => {
  it("is the same when it is re-issued under a new number or new dates", () => {
    const a = notamKey("WSSS", "SX0151/26 AIP SUPPLEMENT\nVALIDITY:03SEP26 - 24DEC26\nRWY 02R/20L WILL NOT BE AVBL")
    const b = notamKey("WSSS", "SX0188/26 AIP SUPPLEMENT\nVALIDITY: 03SEP26 - 31JAN27\nRWY 02R/20L  WILL NOT BE AVBL")
    expect(a).toBe(b)
  })
  it("differs when what it says differs, or where", () => {
    expect(notamKey("WSSS", "TWY S2 CLSD")).not.toBe(notamKey("WSSS", "TWY S3 CLSD"))
    expect(notamKey("WSSS", "TWY S2 CLSD")).not.toBe(notamKey("WSAP", "TWY S2 CLSD"))
  })
})
