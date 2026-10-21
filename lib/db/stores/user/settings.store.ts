/**
 * The user's synced settings record (`userDb.settings`, one row). What the
 * fields mean and why the record is sparse: lib/settings/user-settings.ts.
 */

import { userDb } from "../../user-db"
import type { UserSettingsRecord } from "@/types/entities/settings.types"
import { SETTINGS_ID } from "@/lib/settings/user-settings"
import { updateEntity, silentDeleteEntity } from "./crud-helpers"
import { addToSyncQueue, getDeviceId } from "./sync-queue.store"

export async function getSettingsRow(): Promise<UserSettingsRecord | undefined> {
  return userDb.settings.get(SETTINGS_ID)
}

/**
 * Write the given settings fields. Always an UPDATE carrying exactly these
 * fields — even when this device holds no settings row yet. The server
 * inserts it if the account has none, and otherwise applies only these
 * fields over what other devices have set; a create would be a whole record,
 * which is precisely the "new device states every default" write this design
 * exists to prevent.
 */
export async function writeSettings(patch: Record<string, unknown>): Promise<UserSettingsRecord | null> {
  if (Object.keys(patch).length === 0) return (await getSettingsRow()) ?? null
  const existing = await getSettingsRow()
  if (existing) return updateEntity<UserSettingsRecord>(userDb.settings, "settings", SETTINGS_ID, patch)

  const now = Date.now()
  const row: UserSettingsRecord = {
    id: SETTINGS_ID,
    createdAt: now,
    updatedAt: now,
    deviceId: await getDeviceId(),
    syncStatus: "pending",
    ...patch,
  }
  await userDb.settings.put(row)
  await addToSyncQueue("update", "settings", row, { changedFields: Object.keys(patch), baseSeq: 0 })
  return row
}

export function normalizeSettingsFromServer(server: UserSettingsRecord): UserSettingsRecord {
  return { ...server, syncStatus: "synced" }
}

export async function silentDeleteSettings(id: string): Promise<boolean> {
  return silentDeleteEntity<UserSettingsRecord>(userDb.settings, id)
}
