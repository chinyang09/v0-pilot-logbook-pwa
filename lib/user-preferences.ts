export interface UserPreferences {
  key: string // Changed from 'id' to match Dexie schema
  fieldOrder: {
    flight: string[]
    time: string[]
    crew: string[]
    landings: string[]
    approaches: string[]
    notes: string[]
  }
  visibleFields: Record<string, boolean>
  recentlyUsedAirports?: string[]
  recentlyUsedAircraft?: string[]
  createdAt: number
  updatedAt: number
}
