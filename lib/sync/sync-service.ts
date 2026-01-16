import {
  getSyncQueue,
  clearSyncQueueItem,
  markRecordSynced,
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
  userDb,
  type FlightLog,
  type Aircraft,
  type Personnel,
} from "@/lib/db"
import type { SyncQueueItem } from "@/types/sync/sync.types"

// Wrapper for clearing all local data except preferences
async function clearAllLocalData(): Promise<void> {
  await userDb.clearLocalDataForResync()
}

type SyncStatus = "online" | "offline" | "syncing"

class SyncService {
  private status: SyncStatus = "offline"
  private listeners: Set<(status: SyncStatus) => void> = new Set()
  private syncInProgress = false
  private onDataChangedCallbacks: Set<() => void> = new Set()

  constructor() {
    if (typeof window !== "undefined") {
      this.status = navigator.onLine ? "online" : "offline"

      window.addEventListener("online", () => {
        console.log("[v0] Network online - setting status and syncing")
        this.setStatus("online")
        this.fullSync()
      })

      window.addEventListener("offline", () => {
        console.log("[v0] Network offline - setting status")
        this.setStatus("offline")
      })
    }
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

  async fullSync(): Promise<{
    pushed: number
    pulled: number
    failed: number
  }> {
    if (!navigator.onLine || this.syncInProgress) {
      console.log("[v0] Skipping sync - offline or sync in progress")
      return { pushed: 0, pulled: 0, failed: 0 }
    }

    const session = await getUserSession()

    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      console.log("[v0] Skipping sync - no valid or active session")
      return { pushed: 0, pulled: 0, failed: 0 }
    }

    const dbReady = await initializeDB()
    if (!dbReady) {
      console.error("[v0] DB not ready for sync")
      return { pushed: 0, pulled: 0, failed: 0 }
    }

    this.syncInProgress = true
    this.setStatus("syncing")

    console.log("[v0] Starting full sync for user:", session.callsign)

    let pushed = 0
    let pulled = 0
    let failed = 0

    try {
      console.log("[v0] Step 1: Pushing pending changes...")
      const pushResult = await this.pushPendingChanges()
      pushed = pushResult.success
      failed = pushResult.failed
      console.log("[v0] Pushed", pushed, "records, failed", failed)

      await new Promise((resolve) => setTimeout(resolve, 100))

      console.log("[v0] Step 2: Pulling from server...")
      const pullResult = await this.pullFromServer()
      pulled = pullResult.count

      if (pullResult.requiresFullResync) {
        console.log("[v0] Server requires full resync - clearing local data")
        await clearAllLocalData()
        // Re-pull with since=0
        const freshPull = await this.pullFromServer(true)
        pulled = freshPull.count
      }

      console.log("[v0] Pulled", pulled, "records from server")

      await setLastSyncTime(Date.now())

      this.notifyDataChanged()
      console.log("[v0] Full sync complete")
    } catch (error) {
      console.error("[v0] Full sync error:", error)
    } finally {
      this.syncInProgress = false
      this.setStatus(navigator.onLine ? "online" : "offline")
    }

    return { pushed, pulled, failed }
  }

  /**
   * Compact sync queue by merging multiple operations on the same record
   * Rules:
   * - create → update → update = single create with latest data
   * - create → delete = just delete
   * - update → delete = just delete
   * - update → update = single update with latest data
   * - Multiple operations on same record = keep latest operation with latest data
   */
  private compactSyncQueue(queue: SyncQueueItem[]): SyncQueueItem[] {
    console.log(`[v0] Compacting sync queue: ${queue.length} items`)

    // Group by collection and record ID
    const recordOps = new Map<string, SyncQueueItem[]>()

    for (const item of queue) {
      const recordId = (item.data as { id: string }).id
      const key = `${item.collection}:${recordId}`

      if (!recordOps.has(key)) {
        recordOps.set(key, [])
      }
      recordOps.get(key)!.push(item)
    }

    const compacted: SyncQueueItem[] = []

    for (const [key, operations] of recordOps.entries()) {
      // Sort by timestamp to get chronological order
      operations.sort((a, b) => a.timestamp - b.timestamp)

      // Get the latest operation
      const latest = operations[operations.length - 1]

      // Determine the final operation type
      let finalType = latest.type
      let finalData = latest.data

      // If the latest is a delete, that's the final operation
      if (latest.type === "delete") {
        // Check if there was a create before - if yes, we can skip entirely
        const hasCreate = operations.some(op => op.type === "create")
        if (hasCreate) {
          // Created then deleted in same sync - skip this record entirely
          console.log(`[v0] Skipping ${key} - created and deleted in same batch`)
          continue
        }
        // Otherwise, keep the delete
        compacted.push(latest)
        continue
      }

      // If there's a create anywhere in the operations, treat as create with latest data
      const hasCreate = operations.some(op => op.type === "create")
      if (hasCreate) {
        finalType = "create"
      }

      // Use the latest data
      compacted.push({
        ...latest,
        type: finalType,
        data: finalData,
      })
    }

    console.log(`[v0] Compacted to ${compacted.length} items (${queue.length - compacted.length} items merged)`)
    return compacted
  }

  async pushPendingChanges(): Promise<{ success: number; failed: number }> {
    if (!navigator.onLine) {
      return { success: 0, failed: 0 }
    }

    const queue = await getSyncQueue()
    if (queue.length === 0) {
      return { success: 0, failed: 0 }
    }

    // Compact the queue to reduce operations
    const compactedQueue = this.compactSyncQueue(queue)

    if (compactedQueue.length === 0) {
      console.log("[v0] All operations cancelled out - clearing queue")
      // Clear all original queue items since they cancelled out
      for (const item of queue) {
        await clearSyncQueueItem(item.id)
      }
      return { success: queue.length, failed: 0 }
    }

    let success = 0
    let failed = 0

    const headers = await this.getAuthHeaders()

    // Use bulk sync endpoint
    try {
      console.log(`[v0] Sending bulk sync request with ${compactedQueue.length} items`)

      const response = await fetch("/api/sync/bulk", {
        method: "POST",
        headers,
        body: JSON.stringify({ items: compactedQueue }),
      })

      if (response.ok) {
        const result = await response.json()
        console.log(`[v0] Bulk sync response:`, result.summary)

        // Process results
        for (const itemResult of result.results) {
          const originalItem = compactedQueue.find(item => item.id === itemResult.queueItemId)
          if (!originalItem) continue

          if (itemResult.success) {
            // Handle rejection (tombstoned)
            if (itemResult.rejected) {
              console.log(`[v0] Record rejected by server: ${itemResult.reason}`)
              // Delete locally to sync with server state
              const data = originalItem.data as { id: string }
              switch (originalItem.collection) {
                case "flights":
                  await silentDeleteFlight(data.id)
                  break
                case "aircraft":
                  await silentDeleteAircraft(data.id)
                  break
                case "personnel":
                  await silentDeletePersonnel(data.id)
                  break
              }
            } else if (originalItem.type === "create" || originalItem.type === "update") {
              // Mark record as synced
              const data = originalItem.data as { id: string }
              await markRecordSynced(originalItem.collection, data.id)
            }

            // Clear all original queue items that contributed to this compacted item
            // Find all queue items for the same record
            const recordId = (originalItem.data as { id: string }).id
            const itemsToClear = queue.filter(item => {
              const itemRecordId = (item.data as { id: string }).id
              return item.collection === originalItem.collection && itemRecordId === recordId
            })

            for (const item of itemsToClear) {
              await clearSyncQueueItem(item.id)
            }

            success++
          } else {
            console.error(`[v0] Bulk sync item failed:`, itemResult.reason)
            failed++
          }
        }
      } else {
        const errorText = await response.text()
        console.error("[v0] Bulk sync request failed:", response.status, errorText)
        failed = compactedQueue.length
      }
    } catch (error) {
      console.error("[v0] Bulk sync error:", error)
      failed = compactedQueue.length
    }

    console.log(`[v0] Bulk sync complete: ${success} succeeded, ${failed} failed`)
    return { success, failed }
  }

  async pullFromServer(forceFullSync = false): Promise<{
    count: number
    requiresFullResync?: boolean
  }> {
    if (!navigator.onLine) {
      console.log("[v0] Offline - skipping pull")
      return { count: 0 }
    }

    let count = 0
    const rawLastSyncTime = await getLastSyncTime()
    const lastSyncTime = forceFullSync ? 0 : rawLastSyncTime ? Number(rawLastSyncTime) : 0
    console.log(
      "[v0] Last sync time:",
      lastSyncTime,
      lastSyncTime > 0 ? new Date(lastSyncTime).toISOString() : "N/A (full sync)",
    )

    const headers = await this.getAuthHeaders()

    try {
      const collections = ["flights", "aircraft", "personnel"] as const

      for (const collection of collections) {
        try {
          const url = `/api/sync/${collection}?since=${lastSyncTime}`
          console.log("[v0] Fetching from:", url)
          const response = await fetch(url, { headers })

          if (response.ok) {
            const data = await response.json()

            if (data.requiresFullResync) {
              console.log("[v0] Server requires full resync:", data.reason)
              return { count: 0, requiresFullResync: true }
            }

            const records = data.records || []
            const deletions = data.deletions || []

            console.log("[v0] Received", records.length, collection, "and", deletions.length, "deletions from server")

            for (const deletedId of deletions) {
              try {
                switch (collection) {
                  case "flights":
                    await silentDeleteFlight(deletedId)
                    break
                  case "aircraft":
                    await silentDeleteAircraft(deletedId)
                    break
                  case "personnel":
                    await silentDeletePersonnel(deletedId)
                    break
                }
                console.log(`[v0] Silently deleted ${collection} record: ${deletedId}`)
              } catch (deleteError) {
                console.error(`[v0] Error deleting ${collection} record:`, deleteError)
              }
            }

            for (const record of records) {
              try {
                switch (collection) {
                  case "flights":
                    await upsertFlightFromServer(record as FlightLog)
                    break
                  case "aircraft":
                    await upsertAircraftFromServer(record as Aircraft)
                    break
                  case "personnel":
                    await upsertPersonnelFromServer(record as Personnel)
                    break
                }
                count++
              } catch (upsertError) {
                console.error(`[v0] Error upserting ${collection} record:`, upsertError, record)
              }
            }
          } else if (response.status === 401) {
            console.error("[v0] Unauthorized - session may be invalid")
          } else {
            console.error(`[v0] Failed to fetch ${collection}:`, response.status, await response.text())
          }
        } catch (fetchError) {
          console.error(`[v0] Error fetching ${collection}:`, fetchError)
        }
      }
    } catch (error) {
      console.error("[v0] Pull sync error:", error)
    }

    console.log("[v0] Pull complete - total records:", count)
    return { count }
  }

  async syncPendingChanges(): Promise<{ success: number; failed: number }> {
    const result = await this.fullSync()
    return { success: result.pushed, failed: result.failed }
  }
}

export const syncService = new SyncService()
