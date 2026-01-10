"use client"

import { useEffect } from "react"
import { SyncStatus } from "@/components/sync-status"
import { ManageData } from "@/components/manage-data"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { BottomNavbar } from "@/components/bottom-navbar"
import { syncService } from "@/lib/sync-service"
import { refreshAllData } from "@/hooks/use-indexed-db"

export default function DataPage() {
  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-12">
            <h1 className="text-lg font-semibold text-foreground">Data Management</h1>
            <SyncStatus />
          </div>
        </div>
      </div>

      <main className="container mx-auto px-3 pt-16 pb-24">
        <ManageData />
      </main>

      <BottomNavbar />

      <PWAInstallPrompt />
    </div>
  )
}
