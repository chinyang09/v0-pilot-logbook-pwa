/**
 * PWA infrastructure type definitions
 */

/**
 * Service worker message types
 */
export type SwMessageType = "SKIP_WAITING" | "CACHE_URLS" | "CLEAR_CACHE" | "GET_CACHE_STATUS"

/**
 * Service worker message
 */
export interface SwMessage {
  type: SwMessageType
  payload?: unknown
}

/**
 * Cache status response
 */
export interface CacheStatus {
  version: string
  cachedUrls: number
  lastUpdated: number
}

/**
 * Install prompt event
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * Update status
 */
export interface UpdateStatus {
  available: boolean
  installing: boolean
  waiting: boolean
}
