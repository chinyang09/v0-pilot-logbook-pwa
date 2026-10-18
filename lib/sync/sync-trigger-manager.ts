/**
 * When to sync.
 *
 * The old manager gated EVERY trigger on the local queue: "is there anything
 * to push? no → don't sync". That made foreground, focus, network-online and
 * the periodic check all no-ops on a device with nothing pending — which is
 * exactly the device that needs to hear about edits made on another one. The
 * only unconditional pull was the one at login, which is why logging in again
 * was the reliable way to catch up.
 *
 * A sync is now a PULL as much as a push, and the triggers say so:
 *
 * | Trigger | What it does |
 * |---|---|
 * | app opened / foregrounded / focused / back online / page restored | sync now (coalesced) |
 * | a local edit | push after `pushDebounceMs`, never later than `pushMaxWaitMs` |
 * | app visible and online | poll every `pollIntervalMs` (15s) — one tiny request when nothing changed |
 * | a failed cycle with work left | retry with exponential back-off |
 * | app hidden / page hide / unload | keepalive flush of the queue |
 *
 * The poll is cheap because the server answers "nothing new since seq N"
 * with a single lookup (`/api/sync` with `knownSeq`).
 */

export interface SyncOutcome {
  ok?: boolean
  remaining?: number
}

export interface SyncTriggerConfig {
  /** Quiet period after the last edit before pushing it. */
  pushDebounceMs: number
  /** An edit is pushed within this long even while edits keep coming. */
  pushMaxWaitMs: number
  /** Background "anything new?" while the app is visible. */
  pollIntervalMs: number
  /** Lifecycle triggers closer together than this collapse into one sync. */
  lifecycleCoalesceMs: number
  /** Retry back-off after a failed cycle with work left. */
  retryBaseMs: number
  retryMaxMs: number
}

export const DEFAULT_SYNC_TRIGGER_CONFIG: SyncTriggerConfig = {
  pushDebounceMs: 1500,
  pushMaxWaitMs: 8000,
  pollIntervalMs: 15000,
  lifecycleCoalesceMs: 2000,
  retryBaseMs: 5000,
  retryMaxMs: 5 * 60 * 1000,
}

/** Delay before the nth consecutive retry (0-based), doubling to a cap. */
export function retryDelayMs(attempt: number, config: Pick<SyncTriggerConfig, "retryBaseMs" | "retryMaxMs">): number {
  const delay = config.retryBaseMs * 2 ** Math.max(0, attempt)
  return Math.min(delay, config.retryMaxMs)
}

/**
 * How long to wait before pushing, given when the current burst of edits
 * started: the debounce, but never past the burst's max-wait deadline.
 */
export function pushDelayMs(
  firstChangeAt: number,
  now: number,
  config: Pick<SyncTriggerConfig, "pushDebounceMs" | "pushMaxWaitMs">
): number {
  const deadline = firstChangeAt + config.pushMaxWaitMs
  return Math.max(0, Math.min(config.pushDebounceMs, deadline - now))
}

export class SyncTriggerManager {
  private config: SyncTriggerConfig
  private syncCallback: (() => Promise<SyncOutcome | void>) | null = null
  private unloadCallback: (() => void) | null = null
  private isInitialized = false

  private timer: ReturnType<typeof setTimeout> | null = null
  private timerDueAt = 0
  private timerReason = ""
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private burstStartedAt = 0
  private lastLifecycleSyncAt = 0
  private retryAttempt = 0
  private running = false
  private rerun = false

  private isVisible = () => typeof document === "undefined" || document.visibilityState === "visible"
  private isOnline = () => typeof navigator === "undefined" || navigator.onLine

  private onOnline = () => this.lifecycle("network-online")
  private onFocus = () => this.lifecycle("window-focus")
  private onPageShow = () => this.lifecycle("page-show")
  private onVisibilityChange = () => {
    if (this.isVisible()) {
      this.startPolling()
      this.lifecycle("app-foreground")
    } else {
      // iOS rarely fires `beforeunload` for an installed PWA; going to the
      // background is the last reliable moment to get an edit out.
      this.stopPolling()
      this.unloadCallback?.()
    }
  }
  private onPageHide = () => this.unloadCallback?.()

  constructor(config: Partial<SyncTriggerConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_TRIGGER_CONFIG, ...config }
  }

  initialize(syncCallback: () => Promise<SyncOutcome | void>, unloadCallback?: () => void) {
    if (this.isInitialized) return
    this.syncCallback = syncCallback
    this.unloadCallback = unloadCallback ?? null
    this.isInitialized = true

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline)
      window.addEventListener("focus", this.onFocus)
      window.addEventListener("pageshow", this.onPageShow)
      window.addEventListener("pagehide", this.onPageHide)
      window.addEventListener("beforeunload", this.onPageHide)
      document.addEventListener("visibilitychange", this.onVisibilityChange)
    }
    if (this.isVisible()) this.startPolling()
    console.log("[Sync] trigger manager initialized")
  }

  /** A local edit happened — push it soon. */
  notifyDataChanged() {
    if (!this.isInitialized) return
    const now = Date.now()
    if (this.burstStartedAt === 0) this.burstStartedAt = now
    this.schedule(pushDelayMs(this.burstStartedAt, now, this.config), "local-edit")
  }

  /** The user asked for a sync. */
  async forceSyncNow() {
    await this.runNow("user-force-sync")
  }

  async syncBeforeLogout() {
    await this.runNow("before-logout")
  }

  destroy() {
    this.clearTimer()
    this.stopPolling()
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline)
      window.removeEventListener("focus", this.onFocus)
      window.removeEventListener("pageshow", this.onPageShow)
      window.removeEventListener("pagehide", this.onPageHide)
      window.removeEventListener("beforeunload", this.onPageHide)
      document.removeEventListener("visibilitychange", this.onVisibilityChange)
    }
    this.isInitialized = false
    this.syncCallback = null
    this.unloadCallback = null
    this.burstStartedAt = 0
    this.retryAttempt = 0
  }

  getConfig(): SyncTriggerConfig {
    return { ...this.config }
  }

  updateConfig(config: Partial<SyncTriggerConfig>) {
    this.config = { ...this.config, ...config }
  }

  // -------------------------------------------------------------------------

  /** Focus and visibility arrive together on most platforms — one sync. */
  private lifecycle(reason: string) {
    const now = Date.now()
    if (now - this.lastLifecycleSyncAt < this.config.lifecycleCoalesceMs) return
    this.lastLifecycleSyncAt = now
    this.retryAttempt = 0
    this.schedule(0, reason)
  }

  private startPolling() {
    if (this.pollTimer || !this.isInitialized) return
    this.pollTimer = setInterval(() => {
      if (this.isVisible() && this.isOnline() && !this.timer) void this.execute("poll")
    }, this.config.pollIntervalMs)
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.timerDueAt = 0
    this.timerReason = ""
  }

  /**
   * Arrange a sync `delay` ms from now. A pending sync that is due SOONER is
   * kept — except that a local edit re-arms its own debounce, so a burst of
   * typing pushes once (the caller has already capped the delay at the
   * burst's max-wait deadline).
   */
  private schedule(delay: number, reason: string) {
    const dueAt = Date.now() + delay
    if (this.timer) {
      const rearmDebounce = reason === "local-edit" && this.timerReason === "local-edit"
      if (!rearmDebounce && dueAt >= this.timerDueAt) return
      this.clearTimer()
    }
    this.timerDueAt = dueAt
    this.timerReason = reason
    this.timer = setTimeout(() => {
      this.clearTimer()
      void this.execute(reason)
    }, delay)
  }

  private async runNow(reason: string) {
    this.clearTimer()
    this.retryAttempt = 0
    await this.execute(reason)
  }

  private async execute(reason: string) {
    if (!this.syncCallback) return
    if (!this.isOnline()) return
    if (this.running) {
      // Something asked while a cycle was in flight: run once more after it,
      // so an edit made mid-sync is not left waiting for the next trigger.
      if (reason !== "poll") this.rerun = true
      return
    }
    this.running = true
    // Whatever triggered it, this cycle pushes everything queued so far.
    this.burstStartedAt = 0
    let outcome: SyncOutcome | void = undefined
    try {
      outcome = await this.syncCallback()
    } catch (error) {
      console.error(`[Sync] cycle (${reason}) threw:`, error)
      outcome = { ok: false, remaining: 1 }
    } finally {
      this.running = false
    }

    if (outcome && outcome.ok === false && (outcome.remaining ?? 0) > 0) {
      // Work left and the cycle failed — back off and try again on our own,
      // rather than waiting for the user to do something.
      this.schedule(retryDelayMs(this.retryAttempt++, this.config), "retry")
    } else if (outcome && outcome.ok !== false) {
      this.retryAttempt = 0
    }

    if (this.rerun) {
      this.rerun = false
      this.schedule(0, "rerun")
    }
  }
}

let syncTriggerManagerInstance: SyncTriggerManager | null = null

export function getSyncTriggerManager(): SyncTriggerManager {
  if (!syncTriggerManagerInstance) {
    syncTriggerManagerInstance = new SyncTriggerManager()
  }
  return syncTriggerManagerInstance
}
