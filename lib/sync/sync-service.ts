import {
  getSyncQueue,
  clearSyncQueueItem,
  incrementRetryCount,
  setLastSyncTime,
  initializeDB,
  getUserSession,
  silentDeleteFlight,
  silentDeleteAircraft,
  silentDeletePersonnel,
  silentDeleteScheduleEntry,
  silentDeleteCurrency,
  silentDeleteDiscrepancy,
  bulkUpsertAircraftReferences,
  setCollectionCursor,
  resetAllCollectionCursors,
  reconcilePushedRecords,
  bumpSyncAudit,
  getRoundTripSyncState,
  setRoundTripSyncState,
  requeueOrphanedRecords,
  readSyncSnapshot,
  userDb,
} from "@/lib/db"
import { normalizeFlightFromServer } from "@/lib/db/stores/user/flights.store"
import { normalizeAircraftFromServer } from "@/lib/db/stores/user/aircraft.store"
import { normalizePersonnelFromServer } from "@/lib/db/stores/user/crew.store"
import { normalizeScheduleEntryFromServer } from "@/lib/db/stores/user/schedule.store"
import { normalizeCurrencyFromServer } from "@/lib/db/stores/user/currencies.store"
import { normalizeDiscrepancyFromServer } from "@/lib/db/stores/user/discrepancies.store"
import { referenceDb } from "@/lib/db/reference-db"
import type { SyncQueueItem, SyncCollection, CollectionCursor } from "@/types/sync/sync.types"
import { getSyncTriggerManager } from "./sync-trigger-manager"
import { compactSyncQueue } from "./compact"
import { SYNC_COLLECTIONS, SYNC_SCHEMA_VERSION } from "./schema"
import { pendingEdits, planLocalApply, recordKey, takePushBatch } from "./batch"
import type { Authored } from "./authorship"

// Max attempts before a per-item sync failure is dead-lettered so a poison item
// can't loop forever. Transient network/outage/5xx failures are NOT counted.
const MAX_SYNC_RETRIES = 5

/**
 * Bump to make every device re-pull everything ONCE, the next time it syncs.
 * 2 = the single round-trip protocol: tombstones on the seq counter, and a
 * clean baseline after the old engine left devices that only ever pulled at
 * login (and a crew normalizer that dropped `deletedAt`).
 */
const SYNC_PROTOCOL = 2

/** Records per round trip, and the request budget a push batch must fit. */
const PULL_LIMIT = 500
const PUSH_LIMITS = { maxItems: 200, maxBytes: 1_500_000 }
/** `fetch(..., { keepalive })` bodies are capped at 64KB by the browser. */
const UNLOAD_LIMITS = { maxItems: 100, maxBytes: 60_000 }
/** A cycle that keeps finding more to do stops here and resumes next trigger. */
const MAX_ROUNDS = 200

// Abort any sync request that hangs, so a stalled fetch can't wedge the
// in-flight mutex or the unload flush.
const FETCH_TIMEOUT_MS = 30000

const ORPHAN_SCAN_INTERVAL_MS = 60 * 1000

/** The shared aircraft reference pool changes slowly; don't ask on every poll. */
const AIRCRAFT_REF_INTERVAL_MS = 10 * 60 * 1000

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

type ServerRecord = Record<string, unknown> & Authored & { id: string }

/**
 * Per-collection store handlers, keyed by the closed `SyncCollection` union, so
 * adding a collection is one compile-checked entry here rather than parallel
 * switch/if-else chains. `normalize` fills client defaults on a pulled record;
 * the pull applies them in BULK (`applyServerChanges`), so there is no
 * per-record upsert in this table any more.
 */
const COLLECTION_HANDLERS: Record<
  SyncCollection,
  {
    silentDelete: (id: string) => Promise<unknown>
    normalize: (record: never) => unknown
  }
> = {
  flights: { silentDelete: silentDeleteFlight, normalize: normalizeFlightFromServer },
  aircraft: { silentDelete: silentDeleteAircraft, normalize: normalizeAircraftFromServer },
  personnel: { silentDelete: silentDeletePersonnel, normalize: normalizePersonnelFromServer },
  scheduleEntries: { silentDelete: silentDeleteScheduleEntry, normalize: normalizeScheduleEntryFromServer },
  currencies: { silentDelete: silentDeleteCurrency, normalize: normalizeCurrencyFromServer },
  discrepancies: { silentDelete: silentDeleteDiscrepancy, normalize: normalizeDiscrepancyFromServer },
}

type SyncStatus = "online" | "offline" | "syncing"

export interface SyncRunResult {
  pushed: number
  pulled: number
  failed: number
  /** True when the cycle reached the server and finished cleanly. */
  ok?: boolean
  /** Queue rows still waiting after the cycle (drives retry back-off). */
  remaining?: number
}

interface PushItemResult {
  queueItemId: string
  success: boolean
  rejected?: boolean
  stale?: boolean
  /** The record as the server now holds it, when that differs from what was sent. */
  record?: ServerRecord
  serverSeq?: number
  conflicts?: { field: string; winner: "incoming" | "server" }[]
  reason?: string
}

interface RoundTripResponse {
  results?: PushItemResult[]
  upToDate?: boolean
  requiresFullResync?: boolean
  changes?: Partial<Record<SyncCollection, { records?: ServerRecord[]; deletions?: string[] }>>
  cursors?: Partial<Record<SyncCollection, CollectionCursor>>
  tombSeq?: number
  hasMore?: boolean
  headSeq?: number
  serverNow?: number
}

const BROADCAST_CHANNEL = "oooi-sync"
const SYNC_LOCK = "oooi-sync"

class SyncService {
  private status: SyncStatus = "offline"
  private listeners: Set<(status: SyncStatus) => void> = new Set()
  // Single-flight guard: concurrent triggers coalesce onto the in-flight sync
  // and await its real result, instead of returning a misleading no-op.
  private inFlight: Promise<SyncRunResult> | null = null
  private onDataChangedCallbacks: Set<() => void> = new Set()
  // Registered by the auth provider; called once on a 401 to silently refresh
  // the session before retrying the sync.
  private reauthHandler: (() => Promise<boolean>) | null = null
  // Set when any sync request returns 401 during the current cycle.
  private got401 = false
  private lastAircraftRefPull = 0
  private lastOrphanScan = 0
  // A sync requested while one is running: run once more when it finishes.
  private followUp: Promise<SyncRunResult> | null = null
  // Other TABS of the app on this device share the IndexedDB but not the SWR
  // caches — a sync in one has to tell the others their caches are stale.
  private channel: BroadcastChannel | null = null

  constructor() {
    if (typeof window !== "undefined") {
      this.status = navigator.onLine ? "online" : "offline"
      window.addEventListener("online", () => this.setStatus("online"))
      window.addEventListener("offline", () => this.setStatus("offline"))
      if (typeof BroadcastChannel !== "undefined") {
        this.channel = new BroadcastChannel(BROADCAST_CHANNEL)
        this.channel.onmessage = (e) => {
          if ((e.data as { type?: string })?.type === "changed") this.notifyDataChanged(false)
        }
      }
    }
  }

  initializeTriggers() {
    if (typeof window === "undefined") return
    getSyncTriggerManager().initialize(
      () => this.fullSync(),
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

  /**
   * Push everything this device holds, and say how many changes are STILL
   * unsynced afterwards. Signing out wipes local data, so anything counted
   * here is lost if the sign-out goes ahead — the caller has to ask first.
   *
   * It must run while the session is still valid: the account page used to
   * revoke the session and THEN sign out, so this push got a 401 and every
   * unsynced edit went with the wipe, online or not.
   */
  async flushBeforeSignOut(): Promise<number> {
    try {
      await this.fullSync()
    } catch (error) {
      console.error("[Sync] pre-sign-out push failed:", error)
    }
    return userDb.syncQueue.count().catch(() => 0)
  }

  destroyTriggers() {
    getSyncTriggerManager().destroy()
  }

  /** Register a silent reauth handler (the auth provider's passkey reauth). */
  setReauthHandler(fn: (() => Promise<boolean>) | null) {
    this.reauthHandler = fn
  }

  /**
   * Notify the rest of the app that a server request was rejected as
   * unauthorized, so the auth provider's session monitor can re-validate and
   * flip its reactive `sessionExpired` state without waiting for the next poll.
   */
  private signalUnauthorized() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("auth:unauthorized"))
    }
  }

  private setStatus(status: SyncStatus) {
    if (this.status === status) return
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

  private notifyDataChanged(broadcast = true) {
    this.onDataChangedCallbacks.forEach((cb) => cb())
    if (broadcast) {
      try {
        this.channel?.postMessage({ type: "changed" })
      } catch {
        // A closed channel is not worth failing a sync over.
      }
    }
  }

  /**
   * Sync requests authenticate with the HttpOnly session COOKIE, which the
   * browser attaches by itself on a same-origin request — there is no bearer
   * token to add, and deliberately none stored to add it from.
   */
  private getAuthHeaders(): HeadersInit {
    return { "Content-Type": "application/json" }
  }

  async fullSync(): Promise<SyncRunResult> {
    if (typeof navigator === "undefined" || !navigator.onLine) {
      return { pushed: 0, pulled: 0, failed: 0, ok: false }
    }
    // A sync is already running. It may have read the queue BEFORE whatever
    // prompted this call (an edit made during the initial sync is the common
    // case), so returning its promise would leave that edit for the next
    // trigger — up to a poll interval later. Instead, every caller in the
    // meantime shares ONE follow-up run that starts when this one ends.
    if (this.inFlight) {
      this.followUp ??= this.inFlight
        .catch(() => undefined)
        .then(() => {
          this.followUp = null
          return this.fullSync()
        })
      return this.followUp
    }
    this.inFlight = this.withCrossTabLock(() => this.executeFullSync()).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  /**
   * Two tabs on one device share one queue. Without a lock they push the same
   * rows at the same time and reconcile against each other's half-finished
   * state; the Web Locks API serialises them across tabs (and is a no-op
   * wrapper where unsupported).
   */
  private async withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = (typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined)
    if (!locks?.request) return fn()
    return locks.request(SYNC_LOCK, () => fn()) as Promise<T>
  }

  private async executeFullSync(): Promise<SyncRunResult> {
    const session = await getUserSession()
    if (!session) return { pushed: 0, pulled: 0, failed: 0, ok: false }

    // A locally-expired session: give the registered reauth handler (the
    // custom passkey flow) a chance first, and only bail if that fails. A
    // silent no-op here is what once made a manual resync never prompt re-auth.
    if (session.expiresAt && session.expiresAt < Date.now()) {
      this.signalUnauthorized()
      if (!this.reauthHandler) return { pushed: 0, pulled: 0, failed: 0, ok: false }
      const refreshed = await this.reauthHandler().catch(() => false)
      if (!refreshed) return { pushed: 0, pulled: 0, failed: 0, ok: false }
    }

    const dbReady = await initializeDB()
    if (!dbReady) {
      console.error("[Sync] DB not ready")
      return { pushed: 0, pulled: 0, failed: 0, ok: false }
    }

    const correlationId = crypto.randomUUID().slice(0, 8)
    let result: SyncRunResult = { pushed: 0, pulled: 0, failed: 0, ok: false }

    try {
      this.got401 = false
      result = await this.runCycle(correlationId)

      // If the session expired mid-sync, refresh it once via the registered
      // reauth handler and retry the whole cycle a single time.
      if (this.got401 && this.reauthHandler) {
        console.warn(`[Sync ${correlationId}] 401 - attempting silent reauth`)
        const ok = await this.reauthHandler().catch(() => false)
        if (ok) {
          this.got401 = false
          result = await this.runCycle(correlationId)
        } else {
          console.warn(`[Sync ${correlationId}] reauth failed - session expired`)
        }
      }

      const refPulled = await this.maybePullAircraftReference(session.userId)
      if (result.pushed > 0 || result.pulled > 0 || refPulled > 0) this.notifyDataChanged()
    } catch (error) {
      console.error(`[Sync ${correlationId}] error:`, error)
      result = { ...result, ok: false }
    } finally {
      this.setStatus(navigator.onLine ? "online" : "offline")
    }

    result.remaining = await userDb.syncQueue.count().catch(() => 0)
    return result
  }

  /**
   * First run under this protocol on this device: re-pull everything once
   * (cursors to zero, NOT a data wipe — last-write-wins keeps any unsynced
   * local edit), and give dead-lettered records one more chance. Devices that
   * only ever caught up at login get a clean baseline this way.
   */
  private async ensureProtocol(correlationId: string) {
    const state = await getRoundTripSyncState()
    if (state.protocol >= SYNC_PROTOCOL) return
    console.log(`[Sync ${correlationId}] protocol ${state.protocol} → ${SYNC_PROTOCOL}: re-baselining`)
    await resetAllCollectionCursors(SYNC_COLLECTIONS)
    await requeueOrphanedRecords(SYNC_COLLECTIONS, { includeErrored: true })
    await setRoundTripSyncState({ protocol: SYNC_PROTOCOL, tombSeq: 0, knownSeq: 0 })
  }

  /**
   * One sync cycle: as many round trips as it takes to push the whole queue
   * and drain every change — usually ONE. Each round trip pushes a batch and
   * returns everything newer than the cursors, so a device with nothing to
   * send and nothing to receive costs a single tiny request.
   */
  private async runCycle(correlationId: string): Promise<SyncRunResult> {
    await this.ensureProtocol(correlationId)
    // Cheap but not free (an index query per table) — once a minute is plenty
    // for something that only exists after a crash between two writes.
    if (Date.now() - this.lastOrphanScan > ORPHAN_SCAN_INTERVAL_MS) {
      this.lastOrphanScan = Date.now()
      await requeueOrphanedRecords(SYNC_COLLECTIONS)
    }

    let pushed = 0
    let failed = 0
    let pulled = 0
    // Records attempted this cycle — a failure is not retried inside the same
    // cycle (the trigger manager backs off and tries again).
    const attempted = new Set<string>()

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const queue = await getSyncQueue()
      const compacted = compactSyncQueue(queue)

      if (queue.length > 0 && compacted.length === 0) {
        // Everything cancelled out (created + deleted before syncing). Clear
        // only the snapshot rows so an edit enqueued since survives.
        await userDb.syncQueue.bulkDelete(queue.map((q) => q.id))
      }

      const pending = compacted.filter((item) => !attempted.has(recordKey(item)))
      const batch = takePushBatch(pending, PUSH_LIMITS)
      batch.forEach((item) => attempted.add(recordKey(item)))

      const { state, cursors, since } = await readSyncSnapshot(SYNC_COLLECTIONS)

      // Only show "syncing" for real work — a background "anything new?" that
      // comes back empty should not flash the indicator every half minute.
      if (batch.length > 0 || state.knownSeq === 0) this.setStatus("syncing")
      if (batch.length > 0) await bumpSyncAudit("pushAttempted", batch.length)

      let response: Response
      try {
        response = await fetchWithTimeout("/api/sync", {
          method: "POST",
          headers: this.getAuthHeaders(),
          body: JSON.stringify({
            schemaVersion: SYNC_SCHEMA_VERSION,
            items: batch,
            cursors,
            tombSeq: state.tombSeq,
            since,
            knownSeq: state.knownSeq,
            limit: PULL_LIMIT,
          }),
        })
      } catch (error) {
        // Transient network failure / abort — keep the queue intact, no retries.
        console.warn(`[Sync ${correlationId}] network error (will retry):`, error)
        return { pushed, pulled, failed: failed + batch.length, ok: false }
      }

      if (!response.ok) {
        // 401 → session expired; never dead-letter, signal for one reauth+retry.
        if (response.status === 401) {
          this.got401 = true
          this.signalUnauthorized()
          return { pushed, pulled, failed: failed + batch.length, ok: false }
        }
        const transient = response.status >= 500 || response.status === 429
        if (!transient && batch.length > 0) {
          // Persistent 4xx → poison. Bump retry / dead-letter the batch.
          console.error(`[Sync ${correlationId}] push rejected ${response.status}`)
          for (const item of batch) await this.retryOrDeadLetter(queue, item)
        } else {
          console.warn(`[Sync ${correlationId}] server ${response.status} (will retry)`)
        }
        return { pushed, pulled, failed: failed + batch.length, ok: false }
      }

      const data = (await response.json()) as RoundTripResponse

      if (batch.length > 0) {
        const outcome = await this.processPushResults(queue, batch, data.results ?? [])
        pushed += outcome.success
        failed += outcome.failed
        pulled += outcome.applied
      }

      if (data.requiresFullResync) {
        console.log(`[Sync ${correlationId}] full resync required - clearing data (queue preserved)`)
        await userDb.clearDataTablesForResync()
        await resetAllCollectionCursors(SYNC_COLLECTIONS)
        await setRoundTripSyncState({ tombSeq: 0, knownSeq: 0 })
        await setLastSyncTime(0)
        continue
      }

      if (data.upToDate) {
        if (isSaneSeq(data.serverNow)) await setLastSyncTime(data.serverNow)
        if (pending.length <= batch.length) return { pushed, pulled, failed, ok: true }
        continue
      }

      this.setStatus("syncing")
      pulled += await this.applyServerChanges(data.changes ?? {})
      await this.saveCursors(cursors, data)

      const morePush = pending.length > batch.length
      if (!data.hasMore && !morePush) {
        // Drained cleanly: everything up to headSeq is on this device.
        if (isSaneSeq(data.serverNow)) await setLastSyncTime(data.serverNow)
        if (isSaneSeq(data.headSeq)) await setRoundTripSyncState({ knownSeq: data.headSeq })
        console.log(`[Sync ${correlationId}] done: pushed ${pushed}, pulled ${pulled}, failed ${failed}`)
        return { pushed, pulled, failed, ok: failed === 0 }
      }
    }

    console.warn(`[Sync ${correlationId}] round cap reached - resuming next cycle`)
    return { pushed, pulled, failed, ok: false }
  }

  /** Persist the cursors the server returned — only ever forward. */
  private async saveCursors(previous: Record<SyncCollection, CollectionCursor>, data: RoundTripResponse) {
    for (const collection of SYNC_COLLECTIONS) {
      const next = data.cursors?.[collection]
      const prev = previous[collection]
      if (!next || !isSaneSeq(next.seq) || next.seq < prev.seq) continue
      if (next.seq === prev.seq && (next.id ?? "") === prev.id) continue
      await setCollectionCursor(collection, { seq: next.seq, id: typeof next.id === "string" ? next.id : "" })
    }
    if (isSaneSeq(data.tombSeq)) {
      const state = await getRoundTripSyncState()
      if (data.tombSeq > state.tombSeq) await setRoundTripSyncState({ tombSeq: data.tombSeq })
    }
  }

  /**
   * Write a page of server changes in ONE transaction per collection: one
   * `bulkGet`, one last-write-wins pass in memory, one `bulkPut`, one
   * `bulkDelete`. The old path awaited two lookups and a put per record, which
   * is most of why a first sync of a large logbook took as long as it did.
   */
  private async applyServerChanges(
    changes: NonNullable<RoundTripResponse["changes"]>
  ): Promise<number> {
    let applied = 0
    for (const collection of SYNC_COLLECTIONS) {
      const change = changes[collection]
      const records = (change?.records ?? []).filter((r) => r && typeof r.id === "string")
      const deletions = (change?.deletions ?? []).filter((id) => typeof id === "string")
      if (records.length === 0 && deletions.length === 0) continue

      const normalize = COLLECTION_HANDLERS[collection].normalize as (r: ServerRecord) => ServerRecord
      const table = userDb[collection] as unknown as {
        bulkGet: (ids: string[]) => Promise<(ServerRecord | undefined)[]>
        bulkPut: (rows: ServerRecord[]) => Promise<unknown>
        bulkDelete: (ids: string[]) => Promise<void>
      }

      try {
        // The queue is read in the SAME transaction as the write, so an edit
        // made while this runs is either seen as pending (and kept) or lands
        // after it — never lost under a pulled copy.
        await userDb.transaction("rw", [userDb[collection], userDb.syncQueue], async () => {
          if (records.length > 0) {
            const normalized = records.map((r) => normalize(r))
            const existing = await table.bulkGet(normalized.map((r) => r.id))
            const pending = pendingEdits(
              await userDb.syncQueue.where("collection").equals(collection).toArray()
            )
            const toWrite = planLocalApply(normalized, existing, pending)
            if (toWrite.length > 0) await table.bulkPut(toWrite)
            applied += toWrite.length
          }
          // Deletions after upserts, so a tombstone always wins.
          if (deletions.length > 0) {
            await table.bulkDelete(deletions)
            applied += deletions.length
          }
        })
      } catch (error) {
        console.error(`[Sync] applying ${collection} changes failed:`, error)
        throw error
      }
    }
    return applied
  }

  private async processPushResults(
    queue: SyncQueueItem[],
    batch: SyncQueueItem[],
    results: PushItemResult[]
  ): Promise<{ success: number; failed: number; applied: number }> {
    let success = 0
    let failed = 0
    const reconcileByCollection = new Map<
      SyncCollection,
      { id: string; pushedUpdatedAt?: number; pushedTimestamp: number; serverSeq?: number }[]
    >()
    const staleByCollection: Partial<Record<SyncCollection, { records: ServerRecord[] }>> = {}
    const byId = new Map(batch.map((b) => [b.id, b]))
    const answered = new Set<string>()

    for (const itemResult of results) {
      const original = byId.get(itemResult.queueItemId)
      if (!original) continue
      answered.add(original.id)
      const recordId = (original.data as { id: string }).id

      if (itemResult.success) {
        if (itemResult.rejected) {
          // Purged on another device → delete locally and clear its rows.
          await COLLECTION_HANDLERS[original.collection].silentDelete(recordId)
        }
        if (itemResult.record) {
          // The record as it now stands differs from what was pushed — another
          // device changed other fields, a conflict went the other way, or the
          // push was stale. Take it now (rebased under anything still pending)
          // rather than waiting for a pull that may already be past it.
          ;(staleByCollection[original.collection] ??= { records: [] }).records.push(itemResult.record)
        }
        if (itemResult.conflicts?.length) {
          console.warn(
            `[Sync] ${original.collection}/${recordId}: field conflict on ${itemResult.conflicts
              .map((c) => `${c.field} (${c.winner === "incoming" ? "this device's edit kept" : "other device's edit kept"})`)
              .join(", ")}`
          )
        }
        const entries = reconcileByCollection.get(original.collection) ?? []
        entries.push({
          id: recordId,
          pushedUpdatedAt: (original.data as { updatedAt?: number }).updatedAt,
          pushedTimestamp: original.timestamp,
          serverSeq: typeof itemResult.serverSeq === "number" ? itemResult.serverSeq : undefined,
        })
        reconcileByCollection.set(original.collection, entries)
        success++
      } else {
        await this.retryOrDeadLetter(queue, original)
        failed++
      }
    }

    // An item the server never answered for was not written; count it failed
    // (without a retry bump — it was not the item's fault).
    failed += batch.filter((b) => !answered.has(b.id)).length

    for (const [collection, entries] of reconcileByCollection) {
      await reconcilePushedRecords(collection, entries)
    }
    const applied = await this.applyServerChanges(staleByCollection)
    const mergedFlights = (staleByCollection.flights?.records ?? []).map((r) => r.id)
    if (mergedFlights.length > 0) await this.recomputeMergedFlights(mergedFlights)
    await bumpSyncAudit("pushConfirmed", success)
    return { success, failed, applied }
  }

  /**
   * A merged flight's DERIVED times may be out of step with its inputs.
   *
   * Field-level merge keeps both devices' edits — A set the IN time while B set
   * the OUT time — but each device computed block time, night time and the
   * rest from its OWN half of the picture, so whichever derived value landed
   * last describes neither. The device the merged record comes back to is the
   * one whose view was behind; it recomputes from the combined record and
   * pushes any correction as an ordinary edit (`updateFlight` writes nothing if
   * nothing moved). `recalculateFlightFields` respects `manualOverrides`, so a
   * figure the pilot typed is never replaced, and simulators are skipped the
   * way every other recalculation pass skips them.
   */
  private async recomputeMergedFlights(ids: string[]) {
    try {
      const [{ recalculateFlightFields }, { isSimulatorEntry }, db] = await Promise.all([
        import("@/lib/utils/flight-calculations"),
        import("@/lib/utils/entry-type"),
        import("@/lib/db"),
      ])
      for (const id of ids) {
        const flight = await userDb.flights.get(id)
        if (!flight || isSimulatorEntry(flight) || flight.deletedAt != null) continue
        const [dep, arr] = await Promise.all([
          flight.departureIcao ? db.getAirportByIcao(flight.departureIcao) : flight.departureIata ? db.getAirportByIata(flight.departureIata) : undefined,
          flight.arrivalIcao ? db.getAirportByIcao(flight.arrivalIcao) : flight.arrivalIata ? db.getAirportByIata(flight.arrivalIata) : undefined,
        ])
        const updates = recalculateFlightFields(flight, dep ?? null, arr ?? null)
        if (Object.keys(updates).length > 0) await db.updateFlight(id, updates)
      }
    } catch (error) {
      console.error("[Sync] recomputing merged flights failed:", error)
    }
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

  private async maybePullAircraftReference(userId: string): Promise<number> {
    const now = Date.now()
    if (now - this.lastAircraftRefPull < AIRCRAFT_REF_INTERVAL_MS) return 0
    this.lastAircraftRefPull = now
    const n = await this.pullAircraftReference(userId)
    if (n > 0) console.log(`[Sync] pulled ${n} aircraft refs`)
    return n
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
        const response = await fetchWithTimeout(url, { headers: this.getAuthHeaders() })
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
   * Best-effort final push when the app is hidden or closed. Uses
   * `fetch(..., {keepalive:true})` — NOT `sendBeacon`, which cannot set
   * `Content-Type: application/json`. Push-only (`pull: false`), capped under
   * the browser's 64KB keepalive limit, fire-and-forget: queue rows are
   * cleared on the NEXT confirmed sync, never on send, so a dropped request
   * can't lose data (a re-push of the same version is a no-op server-side).
   */
  flushForUnload(): void {
    if (typeof navigator === "undefined" || !navigator.onLine) return
    void (async () => {
      try {
        const queue = await getSyncQueue()
        if (queue.length === 0) return
        const batch = takePushBatch(compactSyncQueue(queue), UNLOAD_LIMITS)
        if (batch.length === 0) return
        await fetch("/api/sync", {
          method: "POST",
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ schemaVersion: SYNC_SCHEMA_VERSION, items: batch, pull: false }),
          keepalive: true,
        })
      } catch {
        // Unload path — nothing we can do; the next sync will retry.
      }
    })()
  }
}

export const syncService = new SyncService()
