import { getSyncQueue, getLastSyncTime } from "@/lib/db"

/**
 * Configuration for sync triggers
 */
export interface SyncTriggerConfig {
  // Queue size threshold (trigger if queue >= this)
  queueSizeThreshold: number
  // Time since last sync in ms (trigger if > this)
  timeSinceLastSyncThreshold: number
  // Debounce delay after last change in ms
  debounceDelay: number
  // Enable lifecycle triggers
  enableLifecycleTriggers: boolean
  // Enable background sync
  enableBackgroundSync: boolean
}

/**
 * Default configuration matching user requirements
 */
const DEFAULT_CONFIG: SyncTriggerConfig = {
  queueSizeThreshold: 20,
  timeSinceLastSyncThreshold: 45000, // 45 seconds
  debounceDelay: 8000, // 8 seconds
  enableLifecycleTriggers: true,
  enableBackgroundSync: true,
}

/**
 * SyncTriggerManager manages intelligent sync triggers based on:
 * 1. Queue size (>= 20 items)
 * 2. Time since last sync (> 45s)
 * 3. Debounce after last change (8s)
 * 4. App lifecycle events (foreground, network online)
 * 5. Background sync via Service Worker
 */
export class SyncTriggerManager {
  private config: SyncTriggerConfig
  private debounceTimer: NodeJS.Timeout | null = null
  private periodicTimer: NodeJS.Timeout | null = null
  private lastChangeTime: number = 0
  private appJustForegrounded: boolean = false
  private networkJustOnline: boolean = false
  private syncCallback: (() => Promise<void>) | null = null
  private isInitialized: boolean = false

  constructor(config: Partial<SyncTriggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize the trigger manager with a sync callback
   */
  initialize(syncCallback: () => Promise<void>) {
    if (this.isInitialized) {
      console.log("[v0] SyncTriggerManager already initialized")
      return
    }

    this.syncCallback = syncCallback
    this.isInitialized = true

    console.log("[v0] Initializing SyncTriggerManager with config:", this.config)

    // Setup lifecycle triggers
    if (this.config.enableLifecycleTriggers) {
      this.setupLifecycleTriggers()
    }

    // Setup periodic check (every 10 seconds)
    this.startPeriodicCheck()

    // Setup background sync registration
    if (this.config.enableBackgroundSync && typeof window !== "undefined") {
      this.registerBackgroundSync()
    }

    console.log("[v0] SyncTriggerManager initialized")
  }

  /**
   * Setup app lifecycle event listeners
   */
  private setupLifecycleTriggers() {
    if (typeof window === "undefined") return

    // Network online event
    window.addEventListener("online", () => {
      console.log("[v0] Network online - marking for sync")
      this.networkJustOnline = true
      this.checkAndTriggerSync("network-online")
    })

    // Visibility change (app foreground/background)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        console.log("[v0] App foregrounded - marking for sync")
        this.appJustForegrounded = true
        this.checkAndTriggerSync("app-foreground")
      }
    })

    // Page focus (alternative to visibilitychange)
    window.addEventListener("focus", () => {
      console.log("[v0] Window focused - checking sync")
      this.appJustForegrounded = true
      this.checkAndTriggerSync("window-focus")
    })

    // Before unload (best effort sync)
    window.addEventListener("beforeunload", () => {
      console.log("[v0] App closing - triggering final sync (best effort)")
      // Best effort - may not complete
      this.triggerSyncImmediate("app-closing")
    })
  }

  /**
   * Start periodic check for sync conditions
   */
  private startPeriodicCheck() {
    // Check every 10 seconds
    this.periodicTimer = setInterval(() => {
      this.checkAndTriggerSync("periodic-check")
    }, 10000)
  }

  /**
   * Register background sync with Service Worker
   */
  private async registerBackgroundSync() {
    if (!("serviceWorker" in navigator) || !("sync" in ServiceWorkerRegistration.prototype)) {
      console.log("[v0] Background Sync API not available")
      return
    }

    try {
      const registration = await navigator.serviceWorker.ready
      await registration.sync.register("sync-flights")
      console.log("[v0] Background sync registered")
    } catch (error) {
      console.error("[v0] Failed to register background sync:", error)
    }
  }

  /**
   * Notify that data has changed (for debounce trigger)
   */
  notifyDataChanged() {
    this.lastChangeTime = Date.now()
    console.log("[v0] Data changed - starting debounce timer")

    // Clear existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // Set new debounce timer
    this.debounceTimer = setTimeout(() => {
      console.log("[v0] Debounce timer expired - checking sync")
      this.checkAndTriggerSync("debounce")
    }, this.config.debounceDelay)
  }

  /**
   * Check if sync should be triggered based on all conditions
   */
  private async shouldSync(): Promise<{
    should: boolean
    reason?: string
  }> {
    // Get queue size
    const queue = await getSyncQueue()
    if (queue.length === 0) {
      return { should: false, reason: "queue-empty" }
    }

    // Check queue size threshold
    if (queue.length >= this.config.queueSizeThreshold) {
      return { should: true, reason: "queue-size-threshold" }
    }

    // Check time since last sync
    const lastSyncTime = await getLastSyncTime()
    const timeSinceLastSync = Date.now() - (lastSyncTime ? Number(lastSyncTime) : 0)
    if (timeSinceLastSync > this.config.timeSinceLastSyncThreshold) {
      return { should: true, reason: "time-since-last-sync" }
    }

    // Check debounce (time since last change)
    if (this.lastChangeTime > 0) {
      const timeSinceLastChange = Date.now() - this.lastChangeTime
      if (timeSinceLastChange > this.config.debounceDelay) {
        return { should: true, reason: "debounce-expired" }
      }
    }

    // Check app lifecycle flags
    if (this.appJustForegrounded) {
      return { should: true, reason: "app-foregrounded" }
    }

    if (this.networkJustOnline) {
      return { should: true, reason: "network-online" }
    }

    return { should: false, reason: "no-condition-met" }
  }

  /**
   * Check conditions and trigger sync if needed
   */
  private async checkAndTriggerSync(trigger: string) {
    if (!this.syncCallback) {
      console.warn("[v0] Sync callback not set")
      return
    }

    if (!navigator.onLine) {
      console.log("[v0] Offline - skipping sync check")
      return
    }

    const { should, reason } = await this.shouldSync()

    if (should) {
      console.log(`[v0] Sync triggered by ${trigger} (reason: ${reason})`)
      await this.executeSyncAndResetFlags()
    } else {
      console.log(`[v0] Sync check (${trigger}): No sync needed (${reason})`)
    }
  }

  /**
   * Execute sync and reset lifecycle flags
   */
  private async executeSyncAndResetFlags() {
    if (!this.syncCallback) return

    try {
      await this.syncCallback()

      // Reset lifecycle flags after successful sync
      this.appJustForegrounded = false
      this.networkJustOnline = false
      this.lastChangeTime = 0
    } catch (error) {
      console.error("[v0] Sync execution failed:", error)
    }
  }

  /**
   * Trigger sync immediately (bypass checks)
   */
  private async triggerSyncImmediate(reason: string) {
    if (!this.syncCallback) return

    console.log(`[v0] Immediate sync triggered: ${reason}`)
    try {
      await this.syncCallback()
    } catch (error) {
      console.error("[v0] Immediate sync failed:", error)
    }
  }

  /**
   * Force sync (called manually by user)
   */
  async forceSyncNow() {
    console.log("[v0] Force sync requested by user")
    await this.triggerSyncImmediate("user-force-sync")
  }

  /**
   * Trigger sync before logout
   */
  async syncBeforeLogout() {
    console.log("[v0] Syncing before logout")
    await this.triggerSyncImmediate("before-logout")
  }

  /**
   * Cleanup timers and listeners
   */
  destroy() {
    console.log("[v0] Destroying SyncTriggerManager")

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    if (this.periodicTimer) {
      clearInterval(this.periodicTimer)
      this.periodicTimer = null
    }

    // Note: We don't remove event listeners since they're global
    // and removing them might affect other instances

    this.isInitialized = false
    this.syncCallback = null
  }

  /**
   * Get current configuration
   */
  getConfig(): SyncTriggerConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SyncTriggerConfig>) {
    this.config = { ...this.config, ...config }
    console.log("[v0] SyncTriggerManager config updated:", this.config)
  }
}

// Singleton instance
let syncTriggerManagerInstance: SyncTriggerManager | null = null

/**
 * Get or create singleton instance
 */
export function getSyncTriggerManager(): SyncTriggerManager {
  if (!syncTriggerManagerInstance) {
    syncTriggerManagerInstance = new SyncTriggerManager()
  }
  return syncTriggerManagerInstance
}
