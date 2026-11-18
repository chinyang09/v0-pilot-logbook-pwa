import { describe, expect, it } from "vitest"
import { crewOnDuty, destinationVisits, legTimes } from "../flight-brief"

const f = (o: Record<string, unknown>) =>
  ({
    id: "x",
    date: "2026-11-18",
    flightNumber: "TR696",
    departureIcao: "WSSS",
    arrivalIcao: "VTCC",
    outTime: "01:05",
    inTime: "04:06",
    scheduledOut: "01:00",
    scheduledIn: "04:00",
    picId: "",
    picName: "",
    sicId: "me",
    sicName: "Self",
    additionalCrew: [],
    deletedAt: null,
    entryType: "flight",
    isSimulator: false,
    ...o,
  }) as never

const crew = [
  { id: "me", name: "Lim Chin Yang", isMe: true },
  { id: "woon", name: "Woon Kok Heng, Benson" },
  { id: "joe", name: "Joe Chin Jia Hao" },
]
const at = (iso: string) => Date.parse(iso)

describe("when a leg is at each end", () => {
  it("flown: its OUT and IN, IN on the next day when it is earlier", () => {
    const t = legTimes(f({ outTime: "22:10", inTime: "01:20" }))
    expect(t.departMs).toBe(at("2026-11-18T22:10Z"))
    expect(t.arriveMs).toBe(at("2026-11-19T01:20Z"))
  })

  it("off blocks, not in: OUT plus the planned block", () => {
    const t = legTimes(f({ outTime: "01:30", inTime: "", scheduledOut: "01:00", scheduledIn: "04:00" }))
    expect(t.arriveMs).toBe(at("2026-11-18T04:30Z"))
  })

  it("not flown: the schedule", () => {
    const t = legTimes(f({ outTime: "", inTime: "", scheduledOut: "23:55", scheduledIn: "01:40" }))
    expect(t.departMs).toBe(at("2026-11-18T23:55Z"))
    expect(t.arriveMs).toBe(at("2026-11-19T01:40Z"))
  })

  it("no times at all: unknown, never noon", () => {
    const t = legTimes(f({ outTime: "", inTime: "", scheduledOut: "", scheduledIn: "" }))
    expect(t.departMs).toBeNull()
    expect(t.arriveMs).toBeNull()
  })
})

describe("who the pilot flies with on a duty", () => {
  const today = "2026-11-22"
  const history = [
    f({ id: "a", date: "2026-11-01", picId: "woon", picName: "Woon Kok Heng, Benson" }),
    f({ id: "b", date: "2026-11-10", picName: "Woon Kok Heng, Bens" }),
  ]
  const legs = [
    f({ id: "l1", date: today, outTime: "", inTime: "", picId: "woon", picName: "Woon Kok Heng, Benson", additionalCrew: [{ name: "Joe Chin Jia Hao", role: "Relief Pilot" }] }),
    f({ id: "l2", date: today, outTime: "", inTime: "", picId: "woon", picName: "Woon Kok Heng, Benson" }),
  ]

  it("each once, with the last flight together BEFORE this duty", () => {
    const mates = crewOnDuty(legs, [...history, ...legs], crew, today)
    expect(mates.map((m) => [m.role, m.personId, m.count, m.last?.flightId ?? null])).toEqual([
      ["PIC", "woon", 2, "b"],
      ["Relief Pilot", "joe", 0, null],
    ])
  })

  it("on the second sector, the first one today is not 'the last time'", () => {
    const flownFirst = { ...(legs[0] as object), outTime: "01:00", inTime: "03:00" } as never
    const mates = crewOnDuty([flownFirst, legs[1]], [...history, flownFirst, legs[1]], crew, today)
    expect(mates[0].last?.flightId).toBe("b")
  })

  it("someone with no card is still named", () => {
    const mates = crewOnDuty([f({ id: "l3", picName: "Tan Ah Kow" })], [], crew, today)
    expect(mates).toEqual([{ personId: null, name: "Tan Ah Kow", role: "PIC", last: null, count: 0 }])
  })
})

describe("when the pilot was last at each destination", () => {
  it("the last flown arrival before the duty, and how often in a year", () => {
    const legs = [f({ id: "l1", date: "2026-11-22", outTime: "", inTime: "", arrivalIcao: "VTCC" }), f({ id: "l2", date: "2026-11-22", outTime: "", inTime: "", departureIcao: "VTCC", arrivalIcao: "WSSS" })]
    const flights = [
      f({ id: "old", date: "2025-01-02", arrivalIcao: "VTCC" }),
      f({ id: "a", date: "2026-10-02", arrivalIcao: "VTCC", flightNumber: "TR600" }),
      f({ id: "b", date: "2026-11-18", arrivalIcao: "VTCC", flightNumber: "TR696" }),
      f({ id: "pos", date: "2026-11-19", arrivalIcao: "VTCC", entryType: "positioning" }),
      f({ id: "unflown", date: "2026-11-20", arrivalIcao: "VTCC", outTime: "", inTime: "" }),
      ...legs,
    ]
    const v = destinationVisits(legs, flights, at("2026-11-22T01:00Z"))
    expect(v.map((x) => [x.icao, x.last?.flightId, x.year, x.total])).toEqual([
      ["VTCC", "b", 2, 3],
      ["WSSS", undefined, 0, 0],
    ])
  })
})
