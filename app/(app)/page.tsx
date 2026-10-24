"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import { mutate } from "swr"

import { PageContainer } from "@/components/page-container"
import { PageLoading } from "@/components/ui/page-loading"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useAuth } from "@/components/providers/auth-provider"
import { CACHE_KEYS, refreshAllData } from "@/hooks/data"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { FlightForm } from "@/components/flight-form"
import { syncService } from "@/lib/sync"

import { usePageActive } from "@/hooks/use-page-active"
import { useDashboardView } from "@/hooks/use-dashboard-view"
import { DashboardActions } from "@/components/dashboard/dashboard-actions"
import { DashboardCalendarPanel, DashboardCalendarSpacer } from "@/components/dashboard/dashboard-calendar-panel"
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
  // The calendar's measured height, which the summary reserves while it is open.
  const [calendarHeight, setCalendarHeight] = useState(0)
  const view = useDashboardView()

  // No `onDataChanged` subscription here: `SyncProvider` owns the one global
  // one. This page is keep-alive, so a second permanent subscriber just ran
  // the whole refresh twice per sync cycle.

  // Keep-alive: only the active tab owns the header actions, and re-activation
  // refreshes data so the retained page never shows stale numbers.
  const isActive = usePageActive("/", refreshAllData)

  const dashboardActions = useMemo(() => <DashboardActions />, [])
  useRegisterMainActions(dashboardActions, isActive)

  // MAIN / DETAIL: a summary flight row opens the FLIGHT in the detail panel;
  // a legal-page requirement (`req:<id>`) is written by the legal page itself,
  // which holds the model it comes from. This effect owns everything else —
  // including clearing the panel, since the dashboard now has one.
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()
  // The pathname moves in the same render as the selection; the active-route
  // store a commit later. Gating on both stops a navigation away from writing
  // the ARRIVING page's selection into this page's panel for a frame.
  const onDashboard = usePathname() === "/"
  useEffect(() => {
    // Keep-alive: a hidden dashboard must not write the panel another page owns.
    if (!isActive || !onDashboard) return
    if (selectedId?.startsWith("req:")) {
      if (view !== "legal") setDetailContent(null)
      return
    }
    setDetailContent(
      selectedId ? (
        <div className="h-full overflow-hidden bg-background">
          <FlightForm
            key={selectedId}
            flightId={selectedId}
            isDesktop={isDesktop}
            onFlightAdded={() => {
              mutate(CACHE_KEYS.flights)
              if (navigator.onLine) syncService.fullSync()
            }}
            onClose={() => setSelectedId(null)}
          />
        </div>
      ) : null
    )
  }, [isActive, onDashboard, selectedId, view, isDesktop, setDetailContent, setSelectedId])

  if (authLoading) {
    return <PageLoading />
  }

  if (!isAuthenticated) {
    return null
  }

  if (view === "legal") {
    // Laid out to the height rather than scrolled into: the chrome offsets are
    // padding on a full-height flex column, and the panel takes what is left.
    //
    // The top is the chrome PLUS the 20px every list leaves under it
    // (`LIST_TOP_GAP`). A list scrolls its first row out of the header's fade;
    // this page cannot scroll, so at the bare chrome offset its first line —
    // the annunciator, the one word the page exists to say — sat under the
    // veil for good (~50% of the background over it, measured unreadable red
    // on the dark theme). Twenty pixels down the veil is ~10%.
    return (
      <div className="flex h-full min-h-0 flex-col px-panel pt-[calc(var(--chrome-top)+20px)] pb-chrome">
        <LegalDashboard className="min-h-0" />
      </div>
    )
  }

  return (
    // Outer relative wrapper anchors the calendar overlay to the main panel
    // (so on split-pane layouts the picker stays centered over the dashboard,
    // not the entire viewport). Calendar is rendered as a sibling of
    // PageContainer's scrolling main, so it never scrolls with content.
    //
    // It PUSHES the summary down rather than floating over it. Floating, the
    // period's hero figure sat right under the calendar's glass and read
    // through it, between the day numbers. The spacer is the calendar's own
    // measured height on `PANEL_MOTION`, so the panel opening and the page
    // moving are one movement; `overflow-anchor: none` keeps the push from
    // being cancelled by scroll anchoring (the logbook's rule).
    <div className="relative h-full">
      <PageContainer className="[overflow-anchor:none]">
        <DashboardCalendarSpacer height={calendarHeight} />
        <div className="mx-auto max-w-[1600px] px-panel">
          <SummaryDashboard />
        </div>
      </PageContainer>
      <DashboardCalendarPanel onNaturalHeight={setCalendarHeight} />
    </div>
  )
}
