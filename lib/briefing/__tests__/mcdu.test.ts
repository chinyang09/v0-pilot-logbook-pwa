import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseBriefing } from "../parse"
import { hhmm, initA, initB, tonnes, tripWind } from "../mcdu"
import { notamTitle } from "../notams"

const load = (f: string) => parseBriefing(JSON.parse(readFileSync(join(__dirname, "fixtures", `${f}.pages.json`), "utf8")))
const flat = (page: ReturnType<typeof initA>) => page.rows.map((r) => r.map((s) => s && `${s.label}=${s.value}${s.rest ?? ""}`))

describe("the MCDU pages, as keyed", () => {
  it("formats as the MCDU writes", () => {
    expect(tonnes(2566)).toBe("2.6")
    expect(tonnes(null)).toBe("---.-")
    expect(hhmm("1:07")).toBe("0107")
    expect(hhmm(null)).toBe("----")
    expect(tripWind(-10)).toBe("HD010")
    expect(tripWind(10)).toBe("TL010")
  })

  it("INIT A for TR438 WSSS–WBGG, slot by slot", () => {
    expect(flat(initA(load("tr438-wsss-wbgg"), 25))).toEqual([
      ["CO RTE=SINKCH01", "FROM/TO=WSSS/WBGG"],
      ["ALTN/CO RTE=WSSS/----------", null],
      ["FLT NBR=TR438", null],
      ["DIST=423NM", null],
      ["COST INDEX=20", "TROPO=54700"],
      ["CRZ FL/TEMP=FL290/-26°", "GND TEMP=25°"],
    ])
  })

  it("INIT B for TR438 — the owner's card in tonnes", () => {
    expect(flat(initB(load("tr438-wsss-wbgg")))).toEqual([
      ["TAXI=0.2", "ZFW/ZFWCG=54.9/--.-"],
      ["TRIP/TIME=2.6/0107", "BLOCK=6.1"],
      ["RTE RSV/%=0.2/5.0", null],
      ["ALTN/TIME=2.4/0102", "TOW/LW=60.8/58.2"],
      ["FINAL/TIME=0.8/0030", "TRIP WIND=HD010"],
      ["MIN DEST FOB=3.2", "EXTRA/TIME=0.0/0000"],
    ])
  })

  it("INIT B for TR439 WBGG–WSSS", () => {
    expect(flat(initB(load("tr439-wbgg-wsss")))).toEqual([
      ["TAXI=0.2", "ZFW/ZFWCG=52.8/--.-"],
      ["TRIP/TIME=2.3/0102", "BLOCK=4.2"],
      ["RTE RSV/%=0.2/5.0", null],
      ["ALTN/TIME=0.8/0023", "TOW/LW=56.8/54.5"],
      ["FINAL/TIME=0.7/0030", "TRIP WIND=TL010"],
      ["MIN DEST FOB=1.5", "EXTRA/TIME=0.0/0000"],
    ])
  })

  it("draws what the FMS computes itself in green — TRIP, TOW / LW, EXTRA", () => {
    const refs = initB(load("tr438-wsss-wbgg"))
      .rows.flat()
      .filter((s) => s?.ref)
      .map((s) => s!.label)
    expect(refs).toEqual(["TRIP/TIME", "TOW/LW", "EXTRA/TIME"])
  })

  it("leaves GND TEMP as dashes without a live METAR", () => {
    const row = initA(load("tr439-wbgg-wsss")).rows[5][1]!
    expect(row).toMatchObject({ value: "---°", ref: false })
  })
})

describe("a NOTAM's title, for its collapsed row", () => {
  const b = load("tr438-wsss-wbgg")
  const title = (id: string) => notamTitle(b.notams.items.find((n) => n.id === id)!)
  it("skips an AIP supplement's number, heading, aerodrome and validity", () => {
    expect(title("SX171/26")).toBe("FULL CLOSURE OF RWY 02R/20L")
    expect(title("SX151/26")).toBe("UPDATED INFO AND DATA FOR RWY 02R/20L")
  })
  it("carries a line cut on a joining word into the next", () => {
    expect(title("SX168/26")).toBe("TEMPO CLOSURE OF TXL N4 BEHIND ACFT STAND 604 AND DOWNGRADE OF ACFT STAND 603 TO CODE C")
  })
  it("is the first line of an ordinary NOTAM, without its limits", () => {
    expect(title("1A3541/26")).toBe("TWY N2 BEHIND ACFT STAND 504 CLSD.")
    expect(title("1A4401/26")).toBe("DANGER AREA WSD14 ACT")
  })
})
