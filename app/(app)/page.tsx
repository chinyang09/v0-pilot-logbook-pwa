"use client"

import { useMemo } from "react"

import { PageContainer } from "@/components/page-container"
import { PageLoading } from "@/components/ui/page-loading"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useAuth } from "@/components/providers/auth-provider"
import { refreshAllData } from "@/hooks/data"

import { usePageActive } from "@/hooks/use-page-active"
import { useDashboardView } from "@/hooks/use-dashboard-view"
import { DashboardActions } from "@/components/dashboard/dashboard-actions"
import { DashboardCalendarPanel } from "@/components/dashboard/dashboard-calendar-panel"
import { LegalDashboard } from "@/components/dashboard/legal-dashboard"
import { SummaryDashboard } from "@/components/dashboard/summary-dashboard"

/**
 * The dashboard, as two pages behind one toggle.
 *
 * | | Answers | Shape |
 * |---|---|---|
 * | **Legal** | am I current, what must I do, where am I in my duty | one screen, no scroll |
 * | **Summary** | what have I flown and how does it add up | period-scoped, scrolls |
 *
 * They get DIFFERENT containers, and that is the point of splitting them. The
 * legal page is laid out to the available height and fills it — it is read like
 * an instrument, in a couple of seconds, and a pilot should never have to
 * scroll to find out whether they are legal. The summary page is an ordinary
 * scrolling page, because reviewing a month is a different activity with no
 * reason to be cramped.
 */
export default function Dashboard() {
  const { isLoading: authLoading, isAuthenticated } = useAuth()
  const view = useDashboardView()

  // No `onDataChanged` subscription here: `SyncProvider` owns the one global
  // one. This page is keep-alive, so a second permanent subscriber just ran
  // the whole refresh twice per sync cycle.

  // Keep-alive: only the active tab owns the header actions, and re-activation
  // refreshes data so the retained page never shows stale numbers.
  const isActive = usePageActive("/", refreshAllData)

  const dashboardActions = useMemo(() => <DashboardActions />, [])
  useRegisterMainActions(dashboardActions, isActive)

  if (authLoading) {
    return <PageLoading />
  }

  if (!isAuthenticated) {
    return null
  }

  if (view === "legal") {
    // Laid out to the height rather than scrolled into: the chrome offsets are
    // padding on a full-height flex column, and the panel takes what is left.
    return (
      <div className="flex h-full min-h-0 flex-col px-panel pt-chrome pb-chrome">
        <LegalDashboard className="min-h-0" />
      </div>
    )
  }

  return (
    // Outer relative wrapper anchors the calendar overlay to the main panel
    // (so on split-pane layouts the picker stays centered over the dashboard,
    // not the entire viewport). Calendar is rendered as a sibling of
    // PageContainer's scrolling main, so it never scrolls with content.
    <div className="relative h-full">
      <PageContainer>
        <div className="mx-auto max-w-[1600px] px-panel">
          <SummaryDashboard />
        </div>
      </PageContainer>
      <DashboardCalendarPanel />
    </div>
  )
}
