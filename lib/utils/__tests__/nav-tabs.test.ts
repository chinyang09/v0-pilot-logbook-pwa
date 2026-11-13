import { describe, expect, it } from "vitest"
import { normaliseNavTabs } from "@/lib/utils/nav-tabs"

describe("normaliseNavTabs", () => {
  it("keeps two to four tabs in the pilot's order", () => {
    expect(normaliseNavTabs(["logbook", "dashboard"])).toEqual(["logbook", "dashboard"])
    expect(normaliseNavTabs(["fdp", "logbook", "crew"])).toEqual(["fdp", "logbook", "crew"])
    expect(normaliseNavTabs(["dashboard", "logbook", "aircraft", "crew", "bin"])).toEqual([
      "dashboard",
      "logbook",
      "aircraft",
      "crew",
    ])
  })

  it("never leaves a bar with fewer than two", () => {
    expect(normaliseNavTabs(["crew"])).toEqual(["crew", "dashboard"])
    expect(normaliseNavTabs([])).toEqual(["dashboard", "logbook"])
    expect(normaliseNavTabs(undefined)).toEqual(["dashboard", "logbook"])
  })

  it("folds Roster into Logbook and gives its slot away so the bar keeps its size", () => {
    expect(normaliseNavTabs(["dashboard", "logbook", "roster", "crew"])).toEqual([
      "dashboard",
      "logbook",
      "crew",
      "aircraft",
    ])
    expect(normaliseNavTabs(["roster", "dashboard"])).toEqual(["logbook", "dashboard"])
  })

  it("drops duplicates and tabs it does not know", () => {
    expect(normaliseNavTabs(["crew", "crew", "nope" as never, "logbook"])).toEqual(["crew", "logbook"])
  })
})
