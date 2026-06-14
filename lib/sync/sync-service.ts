import {
  getSyncQueue,
  clearSyncQueueItem,
  incrementRetryCount,
  upsertFlightFromServer,
  upsertAircraftFromServer,
  upsertPersonnelFromServer,
  getLastSyncTime,
  setLastSyncTime,
  initializeDB,
  getUserSession,
  silentDeleteFlight,
  silentDeleteAircraft,
  silentDeletePersonnel,
  silentDeleteScheduleEntry,
  silentDeleteCurrency,
  silentDeleteDiscrepancy,
  upsertScheduleEntryFromServer,
  upsertCurrencyFromServer,
  upsertDiscrepancyFromServer,
  bulkUpsertAircraftReferences,
  getCollectionCursor,
  setCollectionCursor,
  resetAllCollectionCursors,
  reconcilePushedRecords,
  bumpSyncAudit,
  userDb,
  type FlightLog,
  type Aircraft,
  type Personnel,
} from "@/lib/db"
import type { ScheduleEntry, Currency, Discrepancy } from "@/types/entities/roster.types"
import { referenceDb } from "@/lib/db/reference-db"
import type { SyncQueueItem, SyncCollection } from "@/types/sync/sync.types"
import { getSyncTriggerManager } from "./sync-trigger-manager"
import { compactSyncQueue } from "./compact"

// Max attempts before a per-item sync failure is dead-lettered so a poison item
// can't loop forever. Transient network/outage/5xx failures are NOT counted.
const MAX_SYNC_RETRIES = 5

// Collections covered by the user-data sync engine, in push/pull order
// (dependency-light collections first so a flight never references an unseen
// aircraft/crew member).
const SYNC_COLLECTIONS: readonly SyncCollection[] = [
  "aircraft",
  "personnel",
  "scheduleEntries",
  "currencies",
  "discrepancies",
  "flights",
]

const PAGE_SIZE = 500

// Abort any sync request that hangs, so a stalled fetch can't wedge the
// in-flight mutex or the unload flush.
const FETCH_TIMEOUT_MS = 30000

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Guard a server-supplied cursor value against NaN/negative/over-range poison. */
function isSaneSeq(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER
}

type SyncStatus = "online" | "offline" | "syncing"

interface PushResult {
  success: number
  failed: number
}

interface PullResult {
  count: number
  requiresFullResync?: boolean
  // Server wall-clock (max across pages) used as the next tombstone watermark.
  serverNow?: number
  // True only if every collection drained cleanly; gates the watermark advance.
  allOk: boolean
}

class SyncService {
  private status: SyncStatus = "offline"
  private listeners: Set<(status: SyncStatus) => void> = new Set()
  // Single-flight guard: concurrent triggers coalesce onto the in-flight sync
  // and await its real result, instead of returning a misleading no-op.
  private inFlight: Promise<{ pushed: number; pulled: number; failed: number }> | null = null
  private onDataChangedCallbacks: Set<() => void> = new Set()
  // Registered by the auth provider; called once on a 401 to silently refresh
  // the session before retrying the sync.
  private reauthHandler: (() => Promise<boolean>) | null = null
  // Set when any sync request returns 401 during the current cycle.
  private got401 = false

  constructor() {
    if (typeof window !== "undefined") {
      this.status = navigator.onLine ? "online" : "offline"
      window.addEventListener("online", () => {
        console.log("[Sync] network online")
        this.setStatus("online")
      })
      window.addEventListener("offline", () => {
        console.log("[Sync] network offline")
        this.setStatus("offline")
      })
    }
  }

  initializeTriggers() {
    if (typeof window === "undefined") return
    const triggerManager = getSyncTriggerManager()
    triggerManager.initialize(
      async () => {
        await this.fullSync()
      },
      () => this.flushForUnload()
    )
    console.log("[Sync] triggers initialized")
  }

  notifyDataChange() {
    getSyncTriggerManager().notifyDataChanged()
  }

  async forceSyncNow() {
    await getSyncTriggerManager().forceSyncNow()
  }

  async syncBeforeLogout() {
    await getSyncTriggerManager().syncBeforeLogout()
  }

  destroyTriggers() {
    getSyncTriggerManager().destroy()
  }

  /** Register a silent reauth handler (the auth provider's passkey reauth). */
  setReauthHandler(fn: (() => Promise<boolean>) | null) {
    this.reauthHandler = fn
  }

  private setStatus(status: SyncStatus) {
    this.status = status
    this.listeners.forEach((listener) => listener(status))
  }

  getStatus(): SyncStatus {
    return this.status
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onDataChanged(callback: () => void): () => void {
    this.onDataChangedCallbacks.add(callback)
    return () => this.onDataChangedCallbacks.delete(callback)
  }

  private notifyDataChanged() {
    this.onDataChangedCallbacks.forEach((cb) => cb())
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    const session = await getUserSession()
    if (!session) {
      return { "Content-Type": "application/json" }
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.sessionToken}`,
    }
  }

  async fullSync(): Promise<{ pushed: number; pulled: number; failed: number }> {
    if (!navigator.onLine) {
      return { pushed: 0, pulled: 0, failed: 0 }
    }
    // Coalesce: if a sync is already running, return its in-flight promise so
    // every caller awaits the same real result.
    if (this.inFlight) {
      return this.inFlight
    }
    this.inFlight = this.executeFullSync().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async executeFullSync(): Promise<{ pushed: number; pulled: number; failed: number }> {
    const session = await getUserSession()
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      return { pushed: 0, pulled: 0, failed: 0 }
    }

    const dbReady = await initializeDB()
    if (!dbReady) {
      console.error("[Sync] DB not ready")
      return { pushed: 0, pulled: 0, failed: 0 }
    }

    const correlationId = crypto.randomUUID().slice(0, 8)
    this.setStatus("syncing")
    console.log(`[Sync ${correlationId}] start for ${session.callsign}`)

    let result = { pushed: 0, pulled: 0, failed: 0 }

    try {
      this.got401 = false
      result = await this.runPushPull(session.userId, correlationId)

      // If the session expired mid-sync, refresh it once via the registered
      // reauth handler and retry the whole cycle a single time.
      if (this.got401 && this.reauthHandler) {
        console.warn(`[Sync ${correlationId}] 401 - attempting silent reauth`)
        const ok = await this.reauthHandler().catch(() => false)
        if (ok) {
          this.got401 = false
          result = await this.runPushPull(session.userId, correlationId)
        } else {
          console.warn(`[Sync ${correlationId}] reauth failed - session expired`)
        }
      }

      this.notifyDataChanged()
      console.log(`[Sync ${correlationId}] complete`)
    } catch (error) {
      console.error(`[Sync ${correlationId}] error:`, error)
    } finally {
      this.setStatus(navigator.onLine ? "online" : "offline")
    }

    return result
  }

  /** One push → pull → reference-pull → watermark cycle. */
  private async runPushPull(
    userId: string,
    correlationId: string
  ): Promise<{ pushed: number; pulled: number; failed: number }> {
    const pushResult = await this.pushPendingChanges(correlationId)
    console.log(`[Sync ${correlationId}] pushed ${pushResult.success}, failed ${pushResult.failed}`)

    let pullResult = await this.pullFromServer(false, correlationId)

    if (pullResult.requiresFullResync) {
      console.log(`[Sync ${correlationId}] full resync required - clearing data (queue preserved)`)
      await userDb.clearDataTablesForResync()
      await resetAllCollectionCursors(SYNC_COLLECTIONS)
      await setLastSyncTime(0)
      await referenceDb.setMetadata(`aircraft-ref-cursor-${userId}`, { enrichedAt: 0, id: "" })
      pullResult = await this.pullFromServer(true, correlationId)
    }
    console.log(`[Sync ${correlationId}] pulled ${pullResult.count}`)

    const refPulled = await this.pullAircraftReference(userId)
    if (refPulled > 0) console.log(`[Sync ${correlationId}] pulled ${refPulled} aircraft refs`)

    // Advance the wall-clock tombstone watermark only when every collection
    // drained cleanly. Per-collection record cursors advance inside pullFromServer.
    if (pullResult.allOk && pullResult.serverNow !== undefined) {
      await setLastSyncTime(pullResult.serverNow)
    } else if (!pullResult.allOk) {
      console.warn(`[Sync ${correlationId}] pull incomplete - watermark unchanged`)
    }

    return { pushed: pushResult.success, pulled: pullResult.count, failed: pushResult.failed }
  }

  private compactSyncQueue(queue: SyncQueueItem[]): SyncQueueItem[] {
    return compactSyncQueue(queue)
  }

  async pushPendingChanges(correlationId = "push"): Promise<PushResult> {
    if (!navigator.onLine) return { success: 0, failed: 0 }

    const queue = await getSyncQueue()
    if (queue.length === 0) return { success: 0, failed: 0 }

    const compacted = this.compactSyncQueue(queue)

    if (compacted.length === 0) {
      // Everything cancelled out (created + deleted before syncing). Clear only
      // the snapshot rows so any edit enqueued after this snapshot survives.
      await userDb.syncQueue.bulkDelete(queue.map((q) => q.id))
      return { success: queue.length, failed: 0 }
    }

    await bumpSyncAudit("pushAttempted", compacted.length)

    let response: Response
    try {
      response = await fetchWithTimeout("/api/sync/bulk", {
        method: "POST",
        headers: await this.getAuthHeaders(),
        body: JSON.stringify({ items: compacted }),
      })
    } catch (error) {
      // Transient network failure / abort — keep the queue intact, no retries.
      console.warn(`[Sync ${correlationId}] push network error (will retry):`, error)
      return { success: 0, failed: compacted.length }
    }

    if (!response.ok) {
      // 401 → session expired; never dead-letter, signal for one reauth+retry.
      if (response.status === 401) {
        this.got401 = true
        console.warn(`[Sync ${correlationId}] push 401 - will reauth`)
        return { success: 0, failed: compacted.length }
      }
      const transient = response.status >= 500 || response.status === 429
      if (transient) {
        console.warn(`[Sync ${correlationId}] push transient ${response.status} (will retry)`)
        return { success: 0, failed: compacted.length }
      }
      // Persistent (4xx) → poison. Bump retry / dead-letter the whole batch.
      console.error(`[Sync ${correlationId}] push poison ${response.status}`)
      for (const item of compacted) await this.retryOrDeadLetter(queue, item)
      return { success: 0, failed: compacted.length }
    }

    const result = await response.json()
    let success = 0
    let failed = 0
    let confirmed = 0
    const reconcileByCollection = new Map<
      SyncCollection,
      { id: string; pushedUpdatedAt?: number; pushedTimestamp: number }[]
    >()

    for (const itemResult of result.results as {
      queueItemId: string
      success: boolean
      rejected?: boolean
      reason?: string
    }[]) {
      const original = compacted.find((c) => c.id === itemResult.queueItemId)
      if (!original) continue
      const recordId = (original.data as { id: string }).id

      if (itemResult.success) {
        confirmed++
        if (itemResult.rejected) {
          // Tombstoned on another device → delete locally and clear its rows.
          switch (original.collection) {
            case "flights":
              await silentDeleteFlight(recordId)
              break
            case "aircraft":
              await silentDeleteAircraft(recordId)
              break
            case "personnel":
              await silentDeletePersonnel(recordId)
              break
            case "scheduleEntries":
              await silentDeleteScheduleEntry(recordId)
              break
            case "currencies":
              await silentDeleteCurrency(recordId)
              break
            case "discrepancies":
              await silentDeleteDiscrepancy(recordId)
              break
          }
        }
        // Reconcile (compare-and-set mark-synced + clear stale rows) runs even
        // for deletes/rejections: the record is gone so no mark happens, but its
        // queue rows up to this push are cleared.
        const entries = reconcileByCollection.get(original.collection) ?? []
        entries.push({
          id: recordId,
          pushedUpdatedAt: (original.data as { updatedAt?: number }).updatedAt,
          pushedTimestamp: original.timestamp,
        })
        reconcileByCollection.set(original.collection, entries)
        success++
      } else {
        await this.retryOrDeadLetter(queue, original)
        failed++
      }
    }

    for (const [collection, entries] of reconcileByCollection) {
      await reconcilePushedRecords(collection, entries)
    }

    await bumpSyncAudit("pushConfirmed", confirmed)
    console.log(`[Sync ${correlationId}] push results: ${success} ok, ${failed} failed`)
    return { success, failed }
  }

  /**
   * Per-item poison handling: bump retry counts on the contributing snapshot
   * rows; once a row passes MAX_SYNC_RETRIES, dead-letter it (drop the row AND
   * flag the record `syncStatus:"error"` so it surfaces rather than silently
   * staying pending forever).
   */
  private async retryOrDeadLetter(queue: SyncQueueItem[], compactedItem: SyncQueueItem) {
    const recordId = (compactedItem.data as { id: string }).id
    const rows = queue.filter(
      (row) =>
        row.collection === compactedItem.collection &&
        (row.data as { id?: string })?.id === recordId &&
        row.timestamp <= compactedItem.timestamp
    )
    let deadLettered = false
    for (const row of rows) {
      if ((row.retryCount || 0) + 1 >= MAX_SYNC_RETRIES) {
        console.warn(`[Sync] dead-lettering ${row.id} after ${MAX_SYNC_RETRIES} attempts`)
        await clearSyncQueueItem(row.id)
        deadLettered = true
      } else {
        await incrementRetryCount(row.id)
      }
    }
    if (deadLettered) {
      try {
        const table = userDb[compactedItem.collection]
        const record = await table.get(recordId)
        if (record) await table.put({ ...record, syncStatus: "error" } as never)
      } catch (e) {
        console.error("[Sync] failed to flag dead-lettered record:", e)
      }
    }
  }

  async pullFromServer(forceFullSync = false, correlationId = "pull"): Promise<PullResult> {
    if (!navigator.onLine) return { count: 0, allOk: false }

    let count = 0
    let allOk = true
    let maxServerNow = 0
    const since = forceFullSync ? 0 : await getLastSyncTime()
    const headers = await this.getAuthHeaders()

    for (const collection of SYNC_COLLECTIONS) {
      try {
        let cursor = forceFullSync ? { seq: 0, id: "" } : await getCollectionCursor(collection)
        let pages = 0

        while (true) {
          const url =
            `/api/sync/${collection}?seq=${cursor.seq}` +
            `&seqId=${encodeURIComponent(cursor.id)}` +
            `&since=${since}&limit=${PAGE_SIZE}`
          const response = await fetchWithTimeout(url, { headers })

          if (response.status === 401) {
            allOk = false
            this.got401 = true
            console.error(`[Sync ${correlationId}] unauthorized pulling ${collection}`)
            break
          }
          if (!response.ok) {
            allOk = false
            console.error(`[Sync ${correlationId}] pull ${collection} failed: ${response.status}`)
            break
          }

          const data = await response.json()
          if (data.requiresFullResync) {
            return { count: 0, requiresFullResync: true, allOk: false }
          }

          for (const deletedId of data.deletions || []) {
            try {
              if (collection === "flights") await silentDeleteFlight(deletedId)
              else if (collection === "aircraft") await silentDeleteAircraft(deletedId)
              else if (collection === "personnel") await silentDeletePersonnel(deletedId)
              else if (collection === "scheduleEntries") await silentDeleteScheduleEntry(deletedId)
              else if (collection === "currencies") await silentDeleteCurrency(deletedId)
              else if (collection === "discrepancies") await silentDeleteDiscrepancy(deletedId)
            } catch (e) {
              console.error(`[Sync ${correlationId}] delete ${collection} error:`, e)
            }
          }

          for (const record of data.records || []) {
            try {
              if (collection === "flights") await upsertFlightFromServer(record as FlightLog)
              else if (collection === "aircraft") await upsertAircraftFromServer(record as Aircraft)
              else if (collection === "personnel") await upsertPersonnelFromServer(record as Personnel)
              else if (collection === "scheduleEntries") await upsertScheduleEntryFromServer(record as ScheduleEntry)
              else if (collection === "currencies") await upsertCurrencyFromServer(record as Currency)
              else if (collection === "discrepancies") await upsertDiscrepancyFromServer(record as Discrepancy)
              count++
            } catch (e) {
              console.error(`[Sync ${correlationId}] upsert ${collection} error:`, e, record)
            }
          }

          if (isSaneSeq(data.serverNow)) {
            maxServerNow = Math.max(maxServerNow, data.serverNow)
          }
          // Cursor sanity guard: a malformed/over-range seq must not poison the
          // watermark. Only advance on a finite, non-decreasing seq.
          if (
            data.nextCursor &&
            isSaneSeq(data.nextCursor.seq) &&
            data.nextCursor.seq >= cursor.seq
          ) {
            cursor = {
              seq: data.nextCursor.seq,
              id: typeof data.nextCursor.id === "string" ? data.nextCursor.id : "",
            }
            // Persist progress per page — keyset is monotonic and upserts are
            // idempotent, so a mid-pull failure simply resumes from here.
            await setCollectionCursor(collection, cursor)
          }

          pages++
          if (!data.hasMore) break
          if (pages > 10000) {
            console.error(`[Sync ${correlationId}] pull ${collection} exceeded page cap`)
            allOk = false
            break
          }
        }
      } catch (error) {
        allOk = false
        console.error(`[Sync ${correlationId}] error pulling ${collection}:`, error)
      }
    }

    return { count, allOk, serverNow: maxServerNow > 0 ? maxServerNow : undefined }
  }

  /**
   * Pull shared aircraft reference data from MongoDB (separate per-user cursor).
   */
  private async pullAircraftReference(userId: string): Promise<number> {
    if (!navigator.onLine) return 0
    try {
      const metaKey = `aircraft-ref-cursor-${userId}`
      const legacyKey = `aircraft-ref-last-sync-${userId}`
      const stored = await referenceDb.getMetadata(metaKey)
      // Migrate from the old single-number cursor if present.
      let cursor: { enrichedAt: number; id: string } =
        stored && typeof stored === "object" && isSaneSeq((stored as { enrichedAt?: number }).enrichedAt)
          ? { enrichedAt: (stored as { enrichedAt: number }).enrichedAt, id: (stored as { id?: string }).id || "" }
          : { enrichedAt: Number((await referenceDb.getMetadata(legacyKey)) || 0) || 0, id: "" }

      let total = 0
      let pages = 0
      while (true) {
        const url =
          `/api/sync/aircraft-reference?since=${cursor.enrichedAt}` +
          `&sinceId=${encodeURIComponent(cursor.id)}`
        const response = await fetchWithTimeout(url, { headers: await this.getAuthHeaders() })
        if (!response.ok) {
          console.error("[Sync] aircraft reference pull failed:", response.status)
          break
        }
        const data = await response.json()
        const records = data.records || []
        if (records.length > 0) total += await bulkUpsertAircraftReferences(records)

        if (
          data.nextCursor &&
          isSaneSeq(data.nextCursor.enrichedAt) &&
          typeof data.nextCursor.id === "string"
        ) {
          cursor = { enrichedAt: data.nextCursor.enrichedAt, id: data.nextCursor.id }
          await referenceDb.setMetadata(metaKey, cursor)
        }
        pages++
        if (!data.hasMore || pages > 10000) break
      }
      return total
    } catch (error) {
      console.error("[Sync] aircraft reference pull error:", error)
      return 0
    }
  }

  async syncPendingChanges(): Promise<{ success: number; failed: number }> {
    const result = await this.fullSync()
    return { success: result.pushed, failed: result.failed }
  }

  /**
   * Best-effort final push on page unload. Uses `fetch(..., {keepalive:true})`
   * — NOT `sendBeacon`, which can't attach the `Authorization` header the bulk
   * endpoint requires. Fire-and-forget and push-only: the response is ignored
   * and queue rows are cleared on the NEXT confirmed sync, never on send, so a
   * dropped unload request can't lose data.
   */
  flushForUnload(): void {
    if (typeof navigator === "undefined" || !navigator.onLine) return
    void (async () => {
      try {
        const queue = await getSyncQueue()
        if (queue.length === 0) return
        const compacted = this.compactSyncQueue(queue)
        if (compacted.length === 0) return
        await fetch("/api/sync/bulk", {
          method: "POST",
          headers: await this.getAuthHeaders(),
          body: JSON.stringify({ items: compacted }),
          keepalive: true,
        })
      } catch {
        // Unload path — nothing we can do; next session's sync will retry.
      }
    })()
  }
}

export const syncService = new SyncService()
