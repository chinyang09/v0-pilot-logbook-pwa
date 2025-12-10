import { getSyncQueue, clearSyncQueueItem, markFlightSynced, type FlightLog } from "./indexed-db"

type SyncStatus = "online" | "offline" | "syncing"

class SyncService {
  private status: SyncStatus = "offline"
  private listeners: Set<(status: SyncStatus) => void> = new Set()

  constructor() {
    if (typeof window !== "undefined") {
      this.status = navigator.onLine ? "online" : "offline"

      window.addEventListener("online", () => {
        this.setStatus("online")
        this.syncPendingChanges()
      })

      window.addEventListener("offline", () => {
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

  async syncPendingChanges(): Promise<{ success: number; failed: number }> {
    if (!navigator.onLine) {
      return { success: 0, failed: 0 }
    }

    this.setStatus("syncing")
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

          // Update local record with MongoDB ID if created
          if (item.type === "create" && item.collection === "flights" && result.mongoId) {
            await markFlightSynced((item.data as FlightLog).id, result.mongoId)
          }

          await clearSyncQueueItem(item.id)
          success++
        } else {
          failed++
        }
      } catch (error) {
        console.error("Sync error:", error)
        failed++
      }
    }

    this.setStatus(navigator.onLine ? "online" : "offline")
    return { success, failed }
  }

  async pullFromServer(): Promise<FlightLog[]> {
    if (!navigator.onLine) return []

    try {
      const response = await fetch("/api/flights")
      if (response.ok) {
        return await response.json()
      }
    } catch (error) {
      console.error("Pull error:", error)
    }
    return []
  }
}

export const syncService = new SyncService()
