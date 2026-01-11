"use client"

import { useEffect } from "react"
import { SyncStatus } from "@/components/sync-status"
import { ManageData } from "@/components/manage-data"
import { PageContainer } from "@/components/page-container"
import { syncService } from "@/lib/sync"
import { refreshAllData } from "@/hooks/data"

export default function DataPage() {
  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-12">
              <h1 className="text-lg font-semibold text-foreground">Data Management</h1>
              <SyncStatus />
            </div>
          </div>
        </header>
      }
    >
      <div className="container mx-auto px-3 pt-4 pb-safe">
        <ManageData />
      </div>
    </PageContainer>
  )
}
