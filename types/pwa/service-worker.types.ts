/**
 * Service worker types
 */

export interface SWMessage {
  type: string
  payload?: any
}

export interface SWMessageEvent extends ExtendableMessageEvent {
  data: SWMessage
}

export type CacheStrategy = "cache-first" | "network-first" | "stale-while-revalidate"

export interface CacheConfig {
  name: string
  strategy: CacheStrategy
  maxAge?: number // In seconds
  maxEntries?: number
}

export interface BackgroundSyncConfig {
  tag: string
  minInterval?: number // Minimum interval between syncs in ms
}
