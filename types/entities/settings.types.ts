/**
 * A user's synced settings record — one per user, id `"settings"`. Its fields
 * are the flat keys in `lib/settings/user-settings.ts` (`display_timeFormat`,
 * `autoFill_night`, …); a key that is absent has never been set and reads as
 * the app default. See that module for why it is flat and sparse.
 */
export interface UserSettingsRecord {
  id: string
  userId?: string
  createdAt: number
  updatedAt?: number
  deletedAt?: number | null
  deviceId?: string
  serverSeq?: number
  syncStatus?: "pending" | "synced" | "error"
  [field: string]: unknown
}
