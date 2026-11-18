import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseTafCache } from "../parse"
import {
  briefStations,
  briefWindow,
  categoryOf,
  hazardsOf,
  metarConditions,
  parseTaf,
  readConditions,
  stationWindows,
} from "../brief"

const xml = readFileSync(path.join(__dirname, "fixtures", "tafs.sample.xml"), "utf8")
const tafs = parseTafCache(xml)
const parsed = (id: string) => parseTaf(tafs[id].raw, tafs[id].issued)
const at = (iso: string) => Date.parse(iso)

describe("reading a TAF into periods", () => {
  it("WSSS: base, BECMG, TEMPO, BECMG — each on its own times", () => {
    const t = parsed("WSSS")
    expect(t.station).toBe("WSSS")
    expect(t.periods.map((p) => p.kind)).toEqual(["base", "BECMG", "TEMPO", "BECMG"])
    expect(t.from).toBe(at("2026-11-18T12:00Z"))
    expect(t.to).toBe(at("2026-11-19T18:00Z"))
    const tempo = t.periods[2]
    expect(tempo.from).toBe(at("2026-11-19T05:00Z"))
    expect(tempo.to).toBe(at("2026-11-19T08:00Z"))
    expect(tempo.text).toBe("TEMPO 1905/1908 3000 TSRA FEW012CB BKN015")
    // A BECMG runs from the start of its change to the next one.
    expect(t.periods[1].from).toBe(at("2026-11-19T04:00Z"))
    expect(t.periods[1].to).toBe(at("2026-11-19T10:00Z"))
  })

  it("a change group keeps what it does not restate", () => {
    const tempo = parsed("WSSS").periods[2]
    // The BECMG before it brought 18010KT; the TEMPO states no wind.
    expect(tempo.conditions.windKt).toBe(10)
    expect(tempo.conditions.visM).toBe(3000)
    expect(categoryOf(tempo.conditions)).toBe("IFR")
  })

  it("a PROB TEMPO is one indicator", () => {
    const t = parseTaf("TAF XXXX 181100Z 1812/1918 9999 FEW020 PROB30 TEMPO 1814/1818 0800 FG", at("2026-11-18T11:00Z"))
    expect(t.periods.map((p) => p.kind)).toEqual(["base", "PROB"])
    expect(t.periods[1]).toMatchObject({ prob: 30, tempo: true })
  })

  it("FM groups run to the next FM, and a day before the issue's is next month", () => {
    const t = parseTaf("TAF KXXX 302330Z 0100/0206 18010KT P6SM SKC FM011500 27015G28KT 3SM -RA OVC008", at("2026-11-30T23:30Z"))
    expect(t.from).toBe(at("2026-12-01T00:00Z"))
    expect(t.periods[0].to).toBe(at("2026-12-01T15:00Z"))
    expect(t.periods[1].from).toBe(at("2026-12-01T15:00Z"))
    expect(t.periods[1].to).toBe(at("2026-12-02T06:00Z"))
    expect(categoryOf(t.periods[1].conditions)).toBe("IFR")
    expect(hazardsOf(t.periods[1].conditions)).toEqual(["G28KT"])
  })
})

describe("conditions", () => {
  it("reads visibility in statute miles, whole and fractional", () => {
    expect(readConditions(["1", "1/2SM"]).visM).toBe(2414)
    expect(readConditions(["P6SM"]).visM).toBe(9999)
  })

  it("CAVOK is clear, and NSW / NSC clear what they name", () => {
    expect(categoryOf(readConditions(["CAVOK"]))).toBe("VFR")
    expect(readConditions(["NSW"]).weather).toEqual([])
  })

  it("names the hazards a briefing would, most serious first", () => {
    expect(hazardsOf(readConditions(["32015G25KT", "-TSRA", "FEW020CB"]))).toEqual(["TS", "CB", "G25KT"])
    expect(hazardsOf(readConditions(["0300", "FG", "VV001"]))).toEqual(["FG", "Vis 300m", "Ceiling 100ft"])
    expect(hazardsOf(readConditions(["9999", "FEW020"]))).toEqual([])
  })

  it("a METAR's trend and remarks are not what it observed", () => {
    const c = metarConditions("METAR WSSS 181430Z 36006KT 9999 FEW016 FEW020CB BKN150 26/25 Q1013 TEMPO 2000 TSRA")
    expect(c.visM).toBe(9999)
    expect(c.weather).toBeUndefined()
    expect(hazardsOf(c)).toEqual(["CB"])
    expect(categoryOf(c)).toBe("VFR")
  })
})

describe("a flight's window at an airport", () => {
  it("VTCC: an arrival inside the evening TEMPO is told about the thunderstorm", () => {
    const b = briefWindow(parsed("VTCC"), at("2026-11-18T19:00Z"), at("2026-11-18T21:00Z"))
    expect(b.touching).toEqual([0, 2])
    expect(b.hazards).toEqual(["TEMPO TS", "TEMPO CB"])
  })

  it("WSSS: a departure before the TEMPO sees VFR and nothing to note", () => {
    const b = briefWindow(parsed("WSSS"), at("2026-11-19T01:00Z"), at("2026-11-19T03:00Z"))
    expect(b.worst).toBe("VFR")
    expect(b.hazards).toEqual([])
  })

  it("WSSS: one inside it sees IFR, TS and CB, marked TEMPO", () => {
    const b = briefWindow(parsed("WSSS"), at("2026-11-19T05:30Z"), at("2026-11-19T07:30Z"))
    expect(b.worst).toBe("IFR")
    expect(b.hazards).toEqual(["TEMPO TS", "TEMPO CB"])
  })

  it("puts each airport's time ± one hour, in the order flown", () => {
    const w = stationWindows([
      { label: "TR490", departureIcao: "WSSS", arrivalIcao: "VTCC", departMs: at("2026-11-18T02:00Z"), arriveMs: at("2026-11-18T04:30Z") },
    ])
    expect(w.map((x) => [x.station, x.role, new Date(x.fromMs).toISOString().slice(11, 16)])).toEqual([
      ["WSSS", "dep", "01:00"],
      ["VTCC", "arr", "03:30"],
    ])
  })
})

describe("each airport of a duty, briefed", () => {
  const windows = stationWindows([
    { label: "TR490", departureIcao: "WSSS", arrivalIcao: "VTCC", departMs: at("2026-11-18T17:00Z"), arriveMs: at("2026-11-18T19:30Z") },
  ])
  const answer = {
    metar: { WSSS: { raw: "METAR WSSS 181430Z 36006KT 9999 FEW016 FEW020CB BKN150 26/25 Q1013 NOSIG", at: at("2026-11-18T14:30Z"), category: "VFR" } },
    taf: { VTCC: { raw: tafs.VTCC.raw, issued: tafs.VTCC.issued } },
  }

  it("lights the TAF periods the arrival falls in, and names what they bring", () => {
    const [sin, bkk] = briefStations(["WSSS", "VTCC"], windows, answer)
    expect(bkk.touchedBy.get(2)?.map((w) => w.label)).toEqual(["TR490"])
    expect(bkk.hazards).toEqual(["TEMPO TS", "TEMPO CB"])
    // No TAF for WSSS here: what the duty meets there is the METAR's.
    expect(sin.taf).toBeNull()
    expect(sin.worst).toBe("VFR")
    expect(sin.hazards).toEqual(["CB"])
  })

  it("a station the source has nothing for keeps its times, with nothing read", () => {
    const [sin] = briefStations(["WSSS"], windows, null)
    expect(sin.windows).toHaveLength(1)
    expect(sin.metar).toBeNull()
    expect(sin.worst).toBeNull()
  })
})

describe("hazards as a line", () => {
  it("groups each tag's hazards under it", async () => {
    const { hazardLine } = await import("../brief")
    expect(hazardLine(["CB", "TEMPO TS", "TEMPO CB", "PROB30 FG"])).toBe("CB · TEMPO TS CB · PROB30 FG")
  })
})
