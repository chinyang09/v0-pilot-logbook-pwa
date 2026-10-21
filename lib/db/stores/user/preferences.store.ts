/**
 * User preferences — composed from TWO places since settings became per user:
 *
 * - the synced settings record (`settings.store.ts`): everything about how
 *   the pilot logs and reads their logbook, the same on every device;
 * - this device's own row (`DEVICE_PREFS_KEY`): theme, palette, custom palette.
 *
 * A device that predates the split still holds its old all-in-one row
 * (`LEGACY_PREFS_KEY`). It is read as a fallback until `migrateLegacyPreferences`
 * has carried its choices up, then deleted.
 */

import { userDb } from "../../user-db"
import type { UserPreferences, DisplayPreferences } from "@/types/db/stores.types"
import { DEFAULT_FIELD_ORDER } from "@/types/db/stores.types"
import type { DraftGenerationConfig } from "@/types/entities/roster.types"
import {
  DEVICE_PREFS_KEY,
  LEGACY_PREFS_KEY,
  deviceFromLegacy,
  legacySeedPatch,
  resolveSettings,
  settingsPatch,
  type DevicePreferences,
  type SyncedPreferences,
} from "@/lib/settings/user-settings"
import { getSettingsRow, writeSettings } from "./settings.store"
import { getRoundTripSyncState } from "./sync-queue.store"

const DEFAULT_DRAFT_CONFIG: DraftGenerationConfig = {
  triggerMode: "day_of",
  hoursBeforeReport: 2,
  autoPopulate: {
    crew: true,
    scheduledTimes: true,
    actualTimes: true,
    flightNumber: true,
    aircraftType: true,
  },
}

async function getLegacyRow(): Promise<UserPreferences | undefined> {
  return (await userDb.preferences.get(LEGACY_PREFS_KEY)) as UserPreferences | undefined
}

/** This device's look: its own row, else what the legacy row said. */
export async function getDevicePreferences(): Promise<Omit<DevicePreferences, "key" | "updatedAt">> {
  const device = (await userDb.preferences.get(DEVICE_PREFS_KEY)) as DevicePreferences | undefined
  if (device) {
    const { key: _k, updatedAt: _u, ...rest } = device
    return rest
  }
  return deviceFromLegacy(await getLegacyRow())
}

async function saveDevicePreferences(patch: Partial<Omit<DevicePreferences, "key" | "updatedAt">>): Promise<void> {
  const current = await getDevicePreferences()
  await userDb.preferences.put({ ...current, ...patch, key: DEVICE_PREFS_KEY, updatedAt: Date.now() })
}

/** The pilot's synced settings, resolved (synced value → legacy row → default). */
export async function getSyncedPreferences(): Promise<SyncedPreferences> {
  const [row, legacy] = await Promise.all([getSettingsRow(), getLegacyRow()])
  return resolveSettings(row, legacy)
}

/**
 * Every preference in the one shape callers have always read. `display.theme`
 * is the DEVICE's stored mode, and absent when this device never chose one.
 */
export async function getUserPreferences(): Promise<UserPreferences | null> {
  const [synced, device, legacy] = await Promise.all([getSyncedPreferences(), getDevicePreferences(), getLegacyRow()])
  return {
    key: LEGACY_PREFS_KEY,
    fieldOrder: synced.fieldOrder,
    visibleFields: synced.visibleFields,
    recentlyUsedAirports: synced.recentlyUsedAirports,
    recentlyUsedAircraft: synced.recentlyUsedAircraft,
    favoriteAircraft: synced.favoriteAircraft,
    ...(synced.draftGenerationConfig && { draftGenerationConfig: synced.draftGenerationConfig }),
    display: { ...synced.display, ...device } as DisplayPreferences,
    autoFill: synced.autoFill,
    dutyTimeDefaults: synced.dutyTimeDefaults,
    navigation: synced.navigation,
    logging: synced.logging,
    // Retired: read only as the last fallback for the PF convention.
    ...(legacy?.importDefaults && { importDefaults: legacy.importDefaults }),
    createdAt: legacy?.createdAt ?? 0,
    updatedAt: legacy?.updatedAt ?? 0,
  }
}

/**
 * Save preferences. The device's keys go to its own row; everything else is
 * diffed against what the settings already resolve to and only what MOVED is
 * written (`settingsPatch`) — so a caller may hand over whole groups without
 * stating every untouched default as a choice.
 */
export async function saveUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const display = prefs.display
  if (display) {
    const device: Partial<Omit<DevicePreferences, "key" | "updatedAt">> = {}
    if (display.theme !== undefined) device.theme = display.theme
    if (display.palette !== undefined) device.palette = display.palette
    if (display.customPalette !== undefined) device.customPalette = display.customPalette
    if (Object.keys(device).length > 0) await saveDevicePreferences(device)
  }

  const next: Partial<SyncedPreferences> = {}
  if (display) {
    const { theme: _t, palette: _p, customPalette: _c, ...rest } = display
    next.display = rest
  }
  if (prefs.autoFill) next.autoFill = prefs.autoFill
  if (prefs.dutyTimeDefaults) next.dutyTimeDefaults = prefs.dutyTimeDefaults
  if (prefs.navigation) next.navigation = prefs.navigation
  if (prefs.logging) next.logging = prefs.logging
  if (prefs.fieldOrder) next.fieldOrder = prefs.fieldOrder
  if (prefs.visibleFields) next.visibleFields = prefs.visibleFields
  if (prefs.favoriteAircraft) next.favoriteAircraft = prefs.favoriteAircraft
  if (prefs.recentlyUsedAirports) next.recentlyUsedAirports = prefs.recentlyUsedAirports
  if (prefs.recentlyUsedAircraft) next.recentlyUsedAircraft = prefs.recentlyUsedAircraft
  if (prefs.draftGenerationConfig) next.draftGenerationConfig = prefs.draftGenerationConfig

  const patch = settingsPatch(await getSyncedPreferences(), next)
  await writeSettings(patch)
}

/**
 * Carry an upgraded device's legacy row up into the synced settings, once.
 *
 * Only after a COMPLETE pull (`knownSeq`): before it, this device cannot know
 * what the account already says, and it would state its own choices over
 * another device's. It seeds only choices it made, only where the account has
 * none (`legacySeedPatch`), keeps the look as the device's own row, and drops
 * the legacy row. Idempotent.
 */
export async function migrateLegacyPreferences(): Promise<boolean> {
  const legacy = await getLegacyRow()
  if (!legacy) return false
  if ((await getRoundTripSyncState()).knownSeq === 0) return false

  if (!(await userDb.preferences.get(DEVICE_PREFS_KEY))) {
    await userDb.preferences.put({ ...deviceFromLegacy(legacy), key: DEVICE_PREFS_KEY, updatedAt: Date.now() })
  }
  await writeSettings(legacySeedPatch(legacy, await getSettingsRow()))
  await userDb.preferences.delete(LEGACY_PREFS_KEY)
  return true
}

/**
 * Get default field order
 */
export function getDefaultFieldOrder() {
  return DEFAULT_FIELD_ORDER
}

/**
 * Add airport to recently used list
 */
export async function addRecentlyUsedAirport(icao: string): Promise<void> {
  const recentlyUsed = (await getSyncedPreferences()).recentlyUsedAirports
  const updated = [icao, ...recentlyUsed.filter((code) => code !== icao)].slice(0, 10)
  await saveUserPreferences({ recentlyUsedAirports: updated })
}

/**
 * Get recently used airports
 */
export async function getRecentlyUsedAirports(): Promise<string[]> {
  return (await getSyncedPreferences()).recentlyUsedAirports
}

/**
 * Add aircraft to recently used list
 */
export async function addRecentlyUsedAircraft(registration: string): Promise<void> {
  const recentlyUsed = (await getSyncedPreferences()).recentlyUsedAircraft
  const updated = [registration, ...recentlyUsed.filter((reg) => reg !== registration)].slice(0, 10)
  await saveUserPreferences({ recentlyUsedAircraft: updated })
}

/**
 * Get recently used aircraft
 */
export async function getRecentlyUsedAircraft(): Promise<string[]> {
  return (await getSyncedPreferences()).recentlyUsedAircraft
}

/**
 * Toggle aircraft favorite status
 */
export async function toggleFavoriteAircraft(registration: string): Promise<boolean> {
  const favorites = (await getSyncedPreferences()).favoriteAircraft
  const isFavorite = favorites.includes(registration)
  const updated = isFavorite ? favorites.filter((r) => r !== registration) : [...favorites, registration]
  await saveUserPreferences({ favoriteAircraft: updated })
  return !isFavorite
}

/**
 * Get favorite aircraft registrations
 */
export async function getFavoriteAircraft(): Promise<string[]> {
  return (await getSyncedPreferences()).favoriteAircraft
}

/**
 * Get draft generation config
 */
export async function getDraftGenerationConfig(): Promise<DraftGenerationConfig> {
  return (await getSyncedPreferences()).draftGenerationConfig || DEFAULT_DRAFT_CONFIG
}

/**
 * Save draft generation config
 */
export async function saveDraftGenerationConfig(config: DraftGenerationConfig): Promise<void> {
  await saveUserPreferences({ draftGenerationConfig: config })
}
