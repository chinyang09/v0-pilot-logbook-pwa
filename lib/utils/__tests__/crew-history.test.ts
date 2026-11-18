import { describe, expect, it } from "vitest"
import { crewFlyingHistory } from "../crew-history"

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
  { id: "wu", name: "Wu Kefei" },
]

describe("when the pilot last flew with each crew member", () => {
  const flights = [
    f({ id: "536", date: "2026-11-16", flightNumber: "TR536", picId: "wu", picName: "Wu Kefei", arrivalIcao: "VVTS" }),
    // An imported flight naming the captain only, truncated to 20 characters.
    f({ id: "696", picName: "Woon Kok Heng, Bens", additionalCrew: [{ name: "Joe Chin Jia Hao", role: "Relief Pilot" }] }),
    f({ id: "697", flightNumber: "TR697", outTime: "05:13", inTime: "08:34", picId: "woon", picName: "Woon Kok Heng, Benson", departureIcao: "VTCC", arrivalIcao: "WSSS" }),
    // Rostered, not flown yet.
    f({ id: "438", date: "2026-11-22", flightNumber: "TR438", outTime: "", inTime: "", scheduledOut: "22:30", picId: "woon", picName: "Woon Kok Heng, Benson" }),
    // Binned, a simulator and a positioning sector are not flying together.
    f({ id: "bin", picId: "wu", picName: "Wu Kefei", date: "2026-11-19", deletedAt: 1 }),
    f({ id: "sim", picId: "wu", picName: "Wu Kefei", date: "2026-11-19", entryType: "simulator", isSimulator: true }),
  ]
  const history = crewFlyingHistory(flights, crew, "2026-11-18")

  it("takes the latest flight flown together, by date and OUT", () => {
    expect(history.get("woon")?.last).toEqual({ flightId: "697", date: "2026-11-18", flightNumber: "TR697", route: "VTCC-WSSS" })
    expect(history.get("woon")?.count).toBe(2)
  })

  it("matches a flight that names the crew member only by a truncated name, and relief pilots", () => {
    expect(history.get("joe")?.last?.flightId).toBe("696")
  })

  it("finds the next rostered flight together", () => {
    expect(history.get("woon")?.next?.flightId).toBe("438")
    expect(history.get("wu")?.next).toBeNull()
  })

  it("leaves out the pilot themself, binned flights and simulators", () => {
    expect(history.has("me")).toBe(false)
    expect(history.get("wu")?.count).toBe(1)
  })
})
