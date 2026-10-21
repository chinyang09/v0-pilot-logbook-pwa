/**
 * Settings that belong to the PILOT, not to the device — synced as one record
 * per user (collection `settings`, id `SETTINGS_ID`).
 *
 * Every preference is its OWN field (`display_timeFormat`, `autoFill_night`,
 * …), never a whole group. The sync engine merges per field, so two devices
 * changing different settings both keep their change; as one `display`
 * object, a device changing the clock format would have sent its whole
 * display group back and reverted whatever another device set in it.
 *
 * And a device only ever writes what the user CHANGED (`settingsPatch`). A
 * key nobody set is simply absent and reads as the app default, so signing in
 * on a new device — every setting at its default — states nothing and cannot
 * overwrite the account's choices. That was the reason for moving them.
 *
 * What stays on the device: the theme (light/dark/system), the palette and a
 * custom palette (`DEVICE_DISPLAY_KEYS`) — how THIS screen looks, which can
 * rightly differ between a phone and an iPad.
 */

import type {
  AutoFillPreferences,
  DisplayPreferences,
  DutyTimeDefaults,
  FieldOrder,
  LoggingPreferences,
  NavigationPreferences,
  UserPreferences,
} from "@/types/db/stores.types"
import {
  DEFAULT_AUTO_FILL_PREFERENCES,
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_DUTY_TIME_DEFAULTS,
  DEFAULT_FIELD_ORDER,
  DEFAULT_LOGGING_PREFERENCES,
  DEFAULT_NAVIGATION_PREFERENCES,
} from "@/types/db/stores.types"
import type { DraftGenerationConfig } from "@/types/entities/roster.types"

/** The one settings record a user has. */
export const SETTINGS_ID = "settings"

/** Display keys that describe this SCREEN, not the pilot. Never synced. */
export const DEVICE_DISPLAY_KEYS = ["theme", "palette", "customPalette"] as const
export type DeviceDisplayKey = (typeof DEVICE_DISPLAY_KEYS)[number]

export type SyncedDisplay = Omit<DisplayPreferences, DeviceDisplayKey>

/** Everything a user's settings record resolves to. */
export interface SyncedPreferences {
  display: SyncedDisplay
  autoFill: AutoFillPreferences
  dutyTimeDefaults: DutyTimeDefaults
  navigation: NavigationPreferences
  logging: LoggingPreferences
  fieldOrder: FieldOrder
  visibleFields: Record<string, boolean>
  favoriteAircraft: string[]
  recentlyUsedAirports: string[]
  recentlyUsedAircraft: string[]
  draftGenerationConfig: DraftGenerationConfig | null
}

type GroupName = "display" | "autoFill" | "dutyTimeDefaults" | "navigation" | "logging"
type WholeName = Exclude<keyof SyncedPreferences, GroupName>

const { theme: _t, palette: _p, customPalette: _c, ...SYNCED_DISPLAY_DEFAULTS } = DEFAULT_DISPLAY_PREFERENCES

/**
 * Each group's DEFAULTS, which also define its keys — add a preference to a
 * group's default object and it is a synced field, with nothing else to edit.
 * The prefix is the stored field's (`autoFill_night`), kept short and fixed:
 * renaming one orphans every value already stored under it.
 */
const GROUPS: Record<GroupName, { prefix: string; defaults: Record<string, unknown> }> = {
  display: { prefix: "display", defaults: SYNCED_DISPLAY_DEFAULTS },
  autoFill: { prefix: "autoFill", defaults: { ...DEFAULT_AUTO_FILL_PREFERENCES } },
  dutyTimeDefaults: { prefix: "duty", defaults: { ...DEFAULT_DUTY_TIME_DEFAULTS } },
  navigation: { prefix: "navigation", defaults: { ...DEFAULT_NAVIGATION_PREFERENCES } },
  logging: { prefix: "logging", defaults: { ...DEFAULT_LOGGING_PREFERENCES } },
}

/** Values that are one field each, whole (a list is replaced, not merged). */
const WHOLE: Record<WholeName, () => unknown> = {
  fieldOrder: () => DEFAULT_FIELD_ORDER,
  visibleFields: () => ({}),
  favoriteAircraft: () => [],
  recentlyUsedAirports: () => [],
  recentlyUsedAircraft: () => [],
  draftGenerationConfig: () => null,
}

const flatKey = (group: GroupName, key: string) => `${GROUPS[group].prefix}_${key}`

/** Every field a settings record can carry, in a stable order. */
export const SETTINGS_FIELD_KEYS: readonly string[] = [
  ...(Object.keys(GROUPS) as GroupName[]).flatMap((g) => Object.keys(GROUPS[g].defaults).map((k) => flatKey(g, k))),
  ...Object.keys(WHOLE),
]

type Row = Record<string, unknown> | null | undefined

const isSet = (v: unknown) => v !== undefined && v !== null

/**
 * What the pilot's settings come to: the synced record's value, else this
 * device's LEGACY row (from before settings were synced — read only until
 * `legacySeedPatch` has carried it up), else the app default.
 */
export function resolveSettings(row: Row, legacy?: Partial<UserPreferences> | null): SyncedPreferences {
  const legacyGroup = (g: GroupName): Record<string, unknown> | undefined =>
    (legacy?.[g as keyof UserPreferences] as Record<string, unknown> | undefined) ?? undefined
  const out: Record<string, unknown> = {}
  for (const g of Object.keys(GROUPS) as GroupName[]) {
    const group: Record<string, unknown> = {}
    const old = legacyGroup(g)
    for (const [key, def] of Object.entries(GROUPS[g].defaults)) {
      const synced = row?.[flatKey(g, key)]
      group[key] = isSet(synced) ? synced : isSet(old?.[key]) ? old![key] : def
    }
    out[g] = group
  }
  for (const [key, def] of Object.entries(WHOLE)) {
    const synced = row?.[key]
    const old = legacy?.[key as keyof UserPreferences]
    out[key] = isSet(synced) ? synced : isSet(old) ? old : def()
  }
  return out as unknown as SyncedPreferences
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The fields to write for a change from `current` to `next` — only those
 * whose value actually moved. A caller may hand over whole groups (the
 * provider does); an untouched key in them is not a change and is not sent,
 * which is what keeps a device at its defaults from stating them.
 */
export function settingsPatch(current: SyncedPreferences, next: Partial<SyncedPreferences>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const g of Object.keys(GROUPS) as GroupName[]) {
    const n = next[g] as Record<string, unknown> | undefined
    if (!n) continue
    const c = current[g] as unknown as Record<string, unknown>
    for (const key of Object.keys(GROUPS[g].defaults)) {
      if (!(key in n) || same(n[key], c[key])) continue
      patch[flatKey(g, key)] = n[key] ?? null
    }
  }
  for (const key of Object.keys(WHOLE) as WholeName[]) {
    if (!(key in next) || same(next[key], current[key])) continue
    patch[key] = next[key] ?? null
  }
  return patch
}

/**
 * What an upgraded device carries up from its legacy row, once — only the
 * choices it MADE (a value differing from the default) and only where the
 * account has none yet. Two devices that both upgrade therefore merge: the
 * first to sync states its choices, the second fills in what is still unset
 * and leaves alone what the first already said.
 */
export function legacySeedPatch(legacy: Partial<UserPreferences> | null | undefined, row: Row): Record<string, unknown> {
  if (!legacy) return {}
  const patch: Record<string, unknown> = {}
  for (const g of Object.keys(GROUPS) as GroupName[]) {
    const old = legacy[g as keyof UserPreferences] as Record<string, unknown> | undefined
    if (!old) continue
    for (const [key, def] of Object.entries(GROUPS[g].defaults)) {
      const k = flatKey(g, key)
      if (!isSet(old[key]) || same(old[key], def) || isSet(row?.[k])) continue
      patch[k] = old[key]
    }
  }
  for (const [key, def] of Object.entries(WHOLE)) {
    const old = legacy[key as keyof UserPreferences]
    if (!isSet(old) || same(old, def()) || isSet(row?.[key])) continue
    patch[key] = old
  }
  return patch
}

/**
 * The device's own half: how this screen looks. Kept in its own preferences
 * row (`DEVICE_PREFS_KEY`), which signing out does NOT clear — the next person
 * to sign in on this phone is still looking at the same screen.
 */
export const DEVICE_PREFS_KEY = "device"
export const LEGACY_PREFS_KEY = "user-prefs"

export interface DevicePreferences {
  key: typeof DEVICE_PREFS_KEY
  theme?: DisplayPreferences["theme"]
  palette?: string
  customPalette?: DisplayPreferences["customPalette"]
  updatedAt: number
}

/** The device keys out of a legacy row, for the first launch after the split. */
export function deviceFromLegacy(legacy: Partial<UserPreferences> | null | undefined): Omit<DevicePreferences, "key" | "updatedAt"> {
  const d = legacy?.display
  return {
    ...(d?.theme && { theme: d.theme }),
    ...(d?.palette && { palette: d.palette }),
    ...(d?.customPalette && { customPalette: d.customPalette }),
  }
}
