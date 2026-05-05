"use client"

import { useEffect, useMemo } from "react"
import { Loader2 } from "lucide-react"

import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { syncService } from "@/lib/sync"
import { useAuth } from "@/components/providers/auth-provider"
import { refreshAllData } from "@/hooks/data"

import { DashboardActions } from "@/components/dashboard/dashboard-actions"
import { DashboardCalendarPanel } from "@/components/dashboard/dashboard-calendar-panel"
import { DashboardGrid } from "@/components/dashboard/dashboard-grid"

export default function Dashboard() {
  const { isLoading: authLoading, isAuthenticated } = useAuth()

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  const dashboardActions = useMemo(() => <DashboardActions />, [])
  useRegisterMainActions(dashboardActions, true)

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    // Outer relative wrapper anchors the calendar overlay to the main panel
    // (so on split-pane layouts the picker stays centered over the dashboard,
    // not the entire viewport). Calendar is rendered as a sibling of
    // PageContainer's scrolling main, so it never scrolls with content.
    <div className="h-full relative">
      <PageContainer>
        <div className="px-2 sm:px-3 pt-2 sm:pt-3 pb-safe space-y-2 sm:space-y-3 max-w-[1600px] mx-auto">
          <DashboardGrid />
        </div>
      </PageContainer>
      <DashboardCalendarPanel />
    </div>
  )
}
