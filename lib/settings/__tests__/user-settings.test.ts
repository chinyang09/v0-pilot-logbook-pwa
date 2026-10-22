import { describe, expect, it } from "vitest"
import {
  SETTINGS_FIELD_KEYS,
  deviceFromLegacy,
  legacySeedPatch,
  resolveSettings,
  settingsPatch,
} from "@/lib/settings/user-settings"
import {
  DEFAULT_AUTO_FILL_PREFERENCES,
  DEFAULT_DISPLAY_PREFERENCES,
  type UserPreferences,
} from "@/types/db/stores.types"

// Settings belong to the user and sync; the theme belongs to the device. The
// rule that makes per-user settings safe is that a device states only what
// the user CHANGED — a new device at its defaults must not overwrite anything.

describe("the settings record's fields", () => {
  it("is flat, one field per preference, and carries no device key", () => {
    expect(SETTINGS_FIELD_KEYS).toContain("display_timeFormat")
    expect(SETTINGS_FIELD_KEYS).toContain("autoFill_night")
    expect(SETTINGS_FIELD_KEYS).toContain("duty_minutesBeforeOut")
    expect(SETTINGS_FIELD_KEYS).toContain("logging_pfRole")
    expect(SETTINGS_FIELD_KEYS).toContain("favoriteAircraft")
    for (const k of ["display_theme", "display_palette", "display_customPalette"]) {
      expect(SETTINGS_FIELD_KEYS).not.toContain(k)
    }
  })
})

describe("resolveSettings", () => {
  it("is the defaults with no record", () => {
    const r = resolveSettings(null)
    expect(r.display.timeFormat).toBe(DEFAULT_DISPLAY_PREFERENCES.timeFormat)
    expect(r.autoFill).toEqual(DEFAULT_AUTO_FILL_PREFERENCES)
    expect(r.logging).toEqual({ seat: null, pfRole: null, pfRoleFrom: null, newFlightPilotFlying: true, authority: "CAAS" })
    expect("theme" in r.display).toBe(false)
  })

  it("takes the synced value over the legacy row, and the legacy row over the default", () => {
    const legacy = { display: { ...DEFAULT_DISPLAY_PREFERENCES, timeFormat: "12h", useZuluTime: false } } as Partial<UserPreferences>
    const r = resolveSettings({ display_timeFormat: "24h-padded" }, legacy)
    expect(r.display.timeFormat).toBe("24h-padded")
    expect(r.display.useZuluTime).toBe(false)
    expect(r.display.airportIdentifier).toBe(DEFAULT_DISPLAY_PREFERENCES.airportIdentifier)
  })
})

describe("settingsPatch", () => {
  it("writes only what moved, even when handed whole groups", () => {
    const current = resolveSettings(null)
    const patch = settingsPatch(current, {
      display: { ...current.display, clockSeparator: "none" },
      autoFill: { ...current.autoFill },
      logging: { ...current.logging },
    })
    expect(patch).toEqual({ display_clockSeparator: "none" })
  })

  it("writes a choice that happens to equal the default once a value was set", () => {
    const current = resolveSettings({ display_timeFormat: "12h" })
    expect(settingsPatch(current, { display: { ...current.display, timeFormat: "24h" } })).toEqual({
      display_timeFormat: "24h",
    })
  })

  it("writes a whole value (a list) as one field", () => {
    const current = resolveSettings({ favoriteAircraft: ["9V-NCA"] })
    expect(settingsPatch(current, { favoriteAircraft: [] })).toEqual({ favoriteAircraft: [] })
  })
})

describe("legacySeedPatch — an upgraded device's one-time carry-up", () => {
  const legacy = {
    display: { ...DEFAULT_DISPLAY_PREFERENCES, timeFormat: "12h", theme: "light", palette: "horizon" },
    autoFill: { ...DEFAULT_AUTO_FILL_PREFERENCES, xc: false },
    favoriteAircraft: ["9V-NCA"],
  } as Partial<UserPreferences>

  it("carries only the choices it made, never a default and never the look", () => {
    expect(legacySeedPatch(legacy, null)).toEqual({
      display_timeFormat: "12h",
      autoFill_xc: false,
      favoriteAircraft: ["9V-NCA"],
    })
  })

  it("leaves alone what the account already says", () => {
    expect(legacySeedPatch(legacy, { display_timeFormat: "24h-padded", autoFill_xc: true })).toEqual({
      favoriteAircraft: ["9V-NCA"],
    })
  })

  it("keeps the look for the device's own row", () => {
    expect(deviceFromLegacy(legacy)).toEqual({ theme: "light", palette: "horizon" })
  })
})
