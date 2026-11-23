/**
 * NOTAM and INTAM words as a reader wants them — the printer's line breaks
 * joined, the writer's kept — off the REAL TR438 package, and the keywords
 * marked.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseBriefing } from "../parse"
import { highlightSpans, notamBody, notamTitle, reflowLines } from "../notam-text"

const b = parseBriefing(JSON.parse(readFileSync(path.join(__dirname, "fixtures", "tr438-wsss-wbgg.pages.json"), "utf8")))
const notam = (id: string) => b.notams.items.find((n) => n.id === id)!

describe("reflowing a NOTAM", () => {
  it("joins the printer's lines into the writer's items", () => {
    const body = notamBody(notam("SX171/26"))
    expect(body.map((x) => x.kind)).toEqual(["item", "item", "item", "item"])
    expect(body[0].text).toBe(
      "- THIS AIRAC AIP SUPPLEMENT IS TO INFORM AIRCRAFT OPERATORS AND PILOTS THAT RUNWAY 02R/20L WILL BE CLOSED FOR ALL AIRCRAFT OPERATIONS FROM 01 OCTOBER 2026, 0000UTC TO 14 APRIL 2027, 2359UTC.",
    )
  })

  it("does not repeat the number, the aerodrome, the VALIDITY line or the title", () => {
    const text = notamBody(notam("SX171/26")).map((x) => x.text).join(" ")
    expect(text).not.toMatch(/SX0171|VALIDITY|WSSS\/SINGAPORE|FULL CLOSURE/)
    expect(notamTitle(notam("SX171/26"))).toBe("FULL CLOSURE OF RWY 02R/20L")
  })

  it("leaves nothing to expand when the title is all of it", () => {
    expect(notamBody(notam("1A3350/26"))).toEqual([])
    expect(notamTitle(notam("1A3350/26"))).toBe("TWY S2 CLSD")
  })

  it("keeps numbered and lettered items, and puts a lone number on its line", () => {
    const body = notamBody(notam("SX172/26"))
    expect(body[0]).toEqual({ kind: "item", text: "2 STEEL AND FRANGIBLE FRAMES" })
    expect(body[1].text).toMatch(/^2\.1 TWO STEEL FRAMES .* MOUNTED ON TOP WILL BE ERECTED/)
    const sx173 = notamBody(notam("SX173/26")).map((x) => x.text)
    expect(sx173).toContain('A) TWY CLSD MARKINGS (YELLOW "X") ARE PAINTED AT ALL ENTRANCES TO THE CLSD RET W3.')
    expect(sx173.filter((t) => /^[A-D]\) /.test(t))).toHaveLength(8)
  })

  it("ends a labelled line at its own end, before the heading under it", () => {
    const sx168 = notamBody(notam("SX168/26")).map((x) => x.text)
    expect(sx168).toContain("PERIOD: FROM 01 OCTOBER 2026, 1101 UTC TO 26 NOVEMBER 2026, 1100 UTC")
  })

  it("keeps rules and labelled lines apart", () => {
    const sx120 = notamBody(notam("SX120/25"))
    expect(sx120.some((x) => x.kind === "rule")).toBe(true)
    const sx174 = notamBody(notam("SX174/26")).map((x) => x.text)
    expect(sx174).toContain("ELEV: 4.74M (15.55FT)")
  })

  it("reads an INTAM the same way", () => {
    const tail = b.intams.find((i) => /TAIL STRIKE/.test(i.title))!
    const blocks = reflowLines(tail.body.split("\n"))
    expect(blocks[0]).toEqual({ kind: "para", text: "A RECENT AIRBUS LANDING IN SINGAPORE RESULTED IN A TAIL STRIKE. CREW ARE TO REVIEW ON THE GROUND CLEARANCE LIMITS FOR THE AIRCRAFT:" })
    expect(blocks[1]).toEqual({ kind: "item", text: "1.THE A321NEO HAS A LOWER MARGIN FOR PITCH COMPARED TO THE A320CEO/NEO." })
  })
})

describe("keywords", () => {
  it("marks facilities with their designators and the words that close them", () => {
    expect(highlightSpans("TWY N2 BEHIND ACFT STAND 504 CLSD.")).toEqual([
      { text: "TWY N2", tone: "facility" },
      { text: " BEHIND " },
      { text: "ACFT STAND 504", tone: "facility" },
      { text: " " },
      { text: "CLSD", tone: "status" },
      { text: "." },
    ])
    const spans = highlightSpans("RWY 02R/20L IS NOT AVBL FOR CIV USE. ILS U/S")
    expect(spans.filter((s) => s.tone).map((s) => [s.text, s.tone])).toEqual([
      ["RWY 02R/20L", "facility"],
      ["NOT AVBL", "status"],
      ["ILS", "facility"],
      ["U/S", "status"],
    ])
  })

  it("leaves a word that only contains a keyword alone", () => {
    expect(highlightSpans("RETAINED STANDARD").every((s) => !s.tone)).toBe(true)
  })
})
