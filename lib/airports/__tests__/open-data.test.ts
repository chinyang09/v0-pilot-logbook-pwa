/**
 * The OurAirports tier: the CSV is read as RFC 4180 (quoted commas, doubled
 * quotes), closed airports are never answered, an airport's own ICAO code
 * outranks a place that merely uses the same string as its GPS code, and the
 * answer is in the airport route's shape with the zone left to the caller.
 */

import { describe, expect, it } from "vitest"
import { buildOpenDataIndex, lookupOpenData, parseCsv } from "../open-data"

const HEADER =
  '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"'

// The first three rows are verbatim from the published file.
const CSV = [
  HEADER,
  '26606,"VOBZ","large_airport","Vijayawada International Airport",16.530011,80.804888,82,"AS","IN","IN-AP","Vijayawada","yes","VOBZ","VGA","VOBZ",,"https://www.aai.aero/en/airports/vijayawada","https://en.wikipedia.org/wiki/Vijayawada_Airport",',
  '26808,"WBGG","large_airport","Kuching International Airport",1.487364,110.352859,89,"AS","MY","MY-13","Kuching","yes","WBGG","KCH","WBGG",,,"https://en.wikipedia.org/wiki/Kuching_International_Airport",',
  '26886,"WSSL","medium_airport","Seletar Airport",1.41555,103.86673,36,"AS","SG","SG-02","Seletar","yes","WSSL","XSP","WSSL",,,"https://en.wikipedia.org/wiki/Seletar_Airport",',
  // A heliport whose GPS code collides with an airport's ICAO code.
  '1,"XX-0001","heliport","Rooftop, ""North"" Pad",1.3,103.8,0,"AS","SG","SG-01","Singapore","no","","","WSSL",,,,',
  // A closed field holding a code nothing live uses.
  '2,"ZZCL","closed","Old Field",10,10,0,"AS","IN","IN-AP","Nowhere","no","ZZCL","ZCL","ZZCL",,,,',
].join("\n")

describe("open-data airports", () => {
  const index = buildOpenDataIndex(CSV)

  it("parses quoted commas and doubled quotes", () => {
    const rows = [...parseCsv(CSV)]
    expect(rows[4][3]).toBe('Rooftop, "North" Pad')
    expect(rows[1]).toHaveLength(19)
  })

  it("answers by ICAO and by IATA, in the route's shape", () => {
    expect(lookupOpenData(index, "vobz")).toEqual({
      icao: "VOBZ",
      iata: "VGA",
      name: "Vijayawada International Airport",
      city: "Vijayawada",
      country: "India",
      countryCode: "IN",
      latitude: 16.530011,
      longitude: 80.804888,
      elevation: 82,
      timezone: "",
    })
    expect(lookupOpenData(index, "KCH")?.icao).toBe("WBGG")
  })

  it("prefers an airport's own ICAO code over another place's GPS code", () => {
    expect(lookupOpenData(index, "WSSL")?.name).toBe("Seletar Airport")
  })

  it("never answers a closed airport", () => {
    expect(lookupOpenData(index, "ZZCL")).toBeNull()
    expect(lookupOpenData(index, "ZCL")).toBeNull()
  })

  it("answers nothing for an unknown or malformed code", () => {
    expect(lookupOpenData(index, "QQQQ")).toBeNull()
    expect(lookupOpenData(index, "W")).toBeNull()
  })
})
