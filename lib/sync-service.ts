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
  type FlightLog,
  type Aircraft,
  type Personnel,
} from "./indexed-db"

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

  async fullSync(): Promise<{ pushed: number; pulled: number; failed: number }> {
    if (!navigator.onLine || this.syncInProgress) {
      console.log("[v0] Skipping sync - offline or sync in progress")
      return { pushed: 0, pulled: 0, failed: 0 }
    }

    const dbReady = await initializeDB()
    if (!dbReady) {
      console.error("[v0] DB not ready for sync")
      return { pushed: 0, pulled: 0, failed: 0 }
    }

    this.syncInProgress = true
    this.setStatus("syncing")

    console.log("[v0] Starting full sync...")

    let pushed = 0
    let pulled = 0
    let failed = 0

    try {
      console.log("[v0] Pulling from server...")
      const pullResult = await this.pullFromServer()
      pulled = pullResult.count
      console.log("[v0] Pulled", pulled, "records from server")

      await new Promise((resolve) => setTimeout(resolve, 100))

      console.log("[v0] Pushing pending changes...")
      const pushResult = await this.pushPendingChanges()
      pushed = pushResult.success
      failed = pushResult.failed
      console.log("[v0] Pushed", pushed, "records, failed", failed)

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

  async pushPendingChanges(): Promise<{ success: number; failed: number }> {
    if (!navigator.onLine) {
      return { success: 0, failed: 0 }
    }

    const queue = await getSyncQueue()
    let success = 0
    let failed = 0

    for (const item of queue) {
      try {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        })

        if (response.ok) {
          const result = await response.json()

          if ((item.type === "create" || item.type === "update") && result.mongoId) {
            const data = item.data as { id: string }
            await markRecordSynced(item.collection, data.id, result.mongoId)
          }

          await clearSyncQueueItem(item.id)
          success++
        } else {
          const errorText = await response.text()
          console.error("Push failed for item:", item.id, errorText)
          failed++
        }
      } catch (error) {
        console.error("Push sync error:", error)
        failed++
      }
    }

    return { success, failed }
  }

  async pullFromServer(): Promise<{ count: number }> {
    if (!navigator.onLine) {
      console.log("[v0] Offline - skipping pull")
      return { count: 0 }
    }

    let count = 0
    const lastSyncTime = await getLastSyncTime()
    console.log("[v0] Last sync time:", lastSyncTime, new Date(lastSyncTime).toISOString())

    try {
      const collections = ["flights", "aircraft", "personnel"] as const

      for (const collection of collections) {
        try {
          const url = `/api/sync/${collection}?since=${lastSyncTime}`
          console.log("[v0] Fetching from:", url)
          const response = await fetch(url)

          if (response.ok) {
            const data = await response.json()
            const records = data.records || []
            console.log("[v0] Received", records.length, collection, "from server")

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
