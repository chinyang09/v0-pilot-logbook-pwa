"use client"

import { useEffect, useMemo, useState } from "react"
import { mutate } from "swr"

import { PageContainer } from "@/components/page-container"
import { PageLoading } from "@/components/ui/page-loading"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useAuth } from "@/components/providers/auth-provider"
import { CACHE_KEYS } from "@/hooks/data"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { FlightForm } from "@/components/flight-form"
import { syncService } from "@/lib/sync"
import { SummaryActions } from "@/components/dashboard/dashboard-actions"
import { DashboardCalendarPanel, DashboardCalendarSpacer } from "@/components/dashboard/dashboard-calendar-panel"
import { SummaryDashboard } from "@/components/dashboard/summary-dashboard"

/**
 * The SUMMARY — what has been flown and how it adds up, over a period (the
 * owner, Nov 2026: "summary will be one by itself"; it was the dashboard's
 * second view behind a toggle). An ordinary scrolling page: reviewing a month
 * is a different activity from checking a duty, with no reason to be cramped.
 *
 * The calendar PUSHES the summary down rather than floating over it: the
 * spacer is the calendar's own measured height on `PANEL_MOTION`, and
 * `overflow-anchor: none` keeps scroll anchoring from cancelling the push.
 */
export default function SummaryPage() {
  const { isLoading: authLoading, isAuthenticated } = useAuth()
  const [calendarHeight, setCalendarHeight] = useState(0)

  const actions = useMemo(() => <SummaryActions />, [])
  useRegisterMainActions(actions, true)

  // MAIN / DETAIL: a flight row opens the flight in the detail panel.
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()
  useEffect(() => {
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
      ) : null,
    )
  }, [selectedId, isDesktop, setDetailContent, setSelectedId])

  if (authLoading) return <PageLoading />
  if (!isAuthenticated) return null

  return (
    <div className="relative h-full">
      <PageContainer className="[overflow-anchor:none]">
        <DashboardCalendarSpacer height={calendarHeight}>
          <div className="mx-auto max-w-[1600px] px-panel">
            <SummaryDashboard />
          </div>
        </DashboardCalendarSpacer>
      </PageContainer>
      <DashboardCalendarPanel onNaturalHeight={setCalendarHeight} />
    </div>
  )
}
