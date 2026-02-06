"use client"

import { useEffect } from "react"
import { ManageData } from "@/components/manage-data"
import { PageContainer } from "@/components/page-container"
import { StandardPageHeader } from "@/components/standard-page-header"
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
      header={<StandardPageHeader title="Data Management" />}
    >
      <div className="px-4 pt-4 pb-safe">
        <ManageData />
      </div>
    </PageContainer>
  )
}
