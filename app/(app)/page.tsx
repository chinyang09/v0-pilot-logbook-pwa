"use client"

import { useEffect, useMemo } from "react"
import { usePathname } from "next/navigation"
import { mutate } from "swr"

import { PageLoading } from "@/components/ui/page-loading"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useAuth } from "@/components/providers/auth-provider"
import { CACHE_KEYS, refreshAllData } from "@/hooks/data"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useMainPanelFullWidth } from "@/lib/layout/panel-mode"
import { FlightForm } from "@/components/flight-form"
import { syncService } from "@/lib/sync"

import { usePageActive } from "@/hooks/use-page-active"
import { whenIdle } from "@/lib/utils/idle"
import { FlightDeckActions } from "@/components/dashboard/dashboard-actions"
import { FlightDashboard } from "@/components/dashboard/flight-dashboard"

const refreshAllDataWhenIdle = () => whenIdle(() => void refreshAllData())

/**
 * The FLIGHT DECK — the app's home: am I fine, where am I in my duty, what is
 * this or the next duty like (the owner, Nov 2026: the flight dashboard and
 * the summary are two pages, "summary will be one by itself"). The Summary is
 * `/summary`.
 *
 * Laid out to the available height and read like an instrument, in a couple
 * of seconds: a pilot should never have to scroll to find out whether they
 * are legal.
 */
export default function Dashboard() {
  const { isLoading: authLoading, isAuthenticated } = useAuth()

  // No `onDataChanged` subscription here: `SyncProvider` owns the one global
  // one. This page is keep-alive, so a second permanent subscriber just ran
  // the whole refresh twice per sync cycle.

  // Keep-alive: only the active tab owns the header actions, and re-activation
  // refreshes data so the retained page never shows stale numbers — at idle,
  // not in the tab switch (see whenIdle).
  const isActive = usePageActive("/", refreshAllDataWhenIdle)

  const dashboardActions = useMemo(() => <FlightDeckActions />, [])
  useRegisterMainActions(dashboardActions, isActive)

  // The WHOLE WIDTH on a desktop, like the FDP chart (the owner, Nov 2026):
  // the tiles are the page, and a card grows out of its tile over it. The
  // detail panel comes back only for a flight opened from a card (Open
  // TR438), and goes again when it is closed.
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()
  // `w:<id>` was a widget's card in the panel, before the page took the
  // whole width — a selection remembered from then is no flight.
  const flightId = selectedId && !selectedId.startsWith("w:") ? selectedId : null
  useMainPanelFullWidth(isActive && !flightId)
  // The pathname moves in the same render as the selection; the active-route
  // store a commit later. Gating on both stops a navigation away from writing
  // the ARRIVING page's selection into this page's panel for a frame.
  const onDashboard = usePathname() === "/"
  useEffect(() => {
    // Keep-alive: a hidden dashboard must not write the panel another page owns.
    if (!isActive || !onDashboard) return
    if (selectedId?.startsWith("w:")) {
      setSelectedId(null, { explicit: false })
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
  }, [isActive, onDashboard, selectedId, isDesktop, setDetailContent, setSelectedId])

  if (authLoading) {
    return <PageLoading />
  }

  if (!isAuthenticated) {
    return null
  }

  // Laid out to the height rather than scrolled into: the chrome offsets are
  // padding on a full-height flex column, and the panel takes what is left.
  // The top is the chrome PLUS the gap every page leaves under it
  // (`--content-top-gap`, 16px).
  return (
    <div className="flex h-full min-h-0 flex-col px-panel pt-[calc(var(--chrome-top)+var(--content-top-gap))] pb-chrome">
      <FlightDashboard className="min-h-0" />
    </div>
  )
}
