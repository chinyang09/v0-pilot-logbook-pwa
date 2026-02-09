"use client"

import type React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { SidebarNav, SidebarToggle } from "@/components/sidebar-nav"
import { SidebarProvider } from "@/hooks/use-sidebar-context"
import { DetailPanelProvider, useDetailPanel } from "@/hooks/use-detail-panel"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { FlightForm } from "@/components/flight-form"
import { mutate } from "swr"
import { CACHE_KEYS } from "@/hooks/data"
import { syncService } from "@/lib/sync"

interface DesktopLayoutProps {
  children: React.ReactNode
}

/**
 * Smart Switcher: renders the correct detail component based on
 * the current route and selected ID.
 *
 * The FlightForm is shown in the detail panel when:
 * 1. On /logbook with a selected flight (normal editing)
 * 2. On picker pages (/aircraft, /airports, /crew) with a flightId param
 *    (user navigated to pick a value — form stays visible, picker shows in main panel)
 *
 * Other pages fall back to the legacy detailContent from context.
 */
function DetailPanelContent() {
  const { selectedId, detailContent } = useDetailPanel()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Determine flightId: either from detail panel selection (logbook) or URL param (picker pages)
  const pickerFlightId = searchParams.get("flightId")
  const isPickerPage = pathname?.includes("/aircraft") || pathname?.includes("/airports") || pathname?.includes("/crew")
  const flightId = (pathname?.includes("/logbook") && selectedId) ? selectedId : (isPickerPage && pickerFlightId) ? pickerFlightId : null

  // Show FlightForm when we have a flight to edit (either on logbook or during picker navigation)
  if (flightId) {
    return (
      <div className="h-full overflow-auto bg-background">
        <FlightForm
          key={flightId}
          flightId={flightId}
          isDesktop
          onFlightAdded={async () => {
            await mutate(CACHE_KEYS.flights)
            await mutate(CACHE_KEYS.stats)
            if (navigator.onLine) {
              syncService.fullSync()
            }
          }}
          onClose={async () => {
            await mutate(CACHE_KEYS.flights)
          }}
        />
      </div>
    )
  }

  // Other pages: fall back to context-provided content
  return (
    <div className="h-full overflow-auto bg-background">
      {detailContent || (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <p>Select an item to view details</p>
        </div>
      )}
    </div>
  )
}

function DesktopLayoutContent({ children }: DesktopLayoutProps) {
  return (
    <div className="relative h-[100dvh] w-full flex bg-background overflow-hidden pt-safe">
      {/* Sidebar */}
      <SidebarNav />

      {/* Main content area - always show with detail panel */}
      <div className="flex-1 flex min-w-0 overflow-x-auto">
        <ResizablePanelGroup direction="horizontal" autoSaveId="desktop-panel-layout" className="h-full min-w-[750px]">
          <ResizablePanel defaultSize={35} minSize={30} style={{ minWidth: "375px" }}>
            <div className="h-full flex flex-col overflow-hidden relative">{children}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={65} minSize={25}>
            <DetailPanelContent />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Sidebar toggle button - positioned to align with sidebar header */}
      <div className="absolute left-3 z-[100] top-[calc(env(safe-area-inset-top)+0.875rem)]">
        <SidebarToggle />
      </div>
    </div>
  )
}

export function DesktopLayout({ children }: DesktopLayoutProps) {
  return (
    <SidebarProvider defaultOpen={true}>
      <DetailPanelProvider>
        <DesktopLayoutContent>{children}</DesktopLayoutContent>
      </DetailPanelProvider>
    </SidebarProvider>
  )
}
