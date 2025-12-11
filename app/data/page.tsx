"use client"

import { useEffect } from "react"
import { Header } from "@/components/header"
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
      <Header />

      <main className="container mx-auto px-4 py-6 pb-24">
        <ManageData />
      </main>

      <BottomNavbar />

      <PWAInstallPrompt />
    </div>
  )
}
