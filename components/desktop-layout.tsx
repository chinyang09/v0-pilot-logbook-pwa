"use client"

import type React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { SidebarNav, SidebarToggle } from "@/components/sidebar-nav"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { FlightForm } from "@/components/flight-form"
import { BottomNavbar } from "@/components/bottom-navbar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { mutate } from "swr"
import { CACHE_KEYS } from "@/hooks/data"
import { syncService } from "@/lib/sync"
import { cn } from "@/lib/utils"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AppShellProps {
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
  const { selectedId, setSelectedId, detailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()
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
          isDesktop={isDesktop}
          onFlightAdded={async () => {
            await mutate(CACHE_KEYS.flights)
            await mutate(CACHE_KEYS.stats)
            if (navigator.onLine) {
              syncService.fullSync()
            }
          }}
          onClose={async () => {
            await mutate(CACHE_KEYS.flights)
            setSelectedId(null)
          }}
        />
      </div>
    )
  }

  // Other pages: fall back to context-provided content
  // On mobile, add a back button header when detail content is shown
  return (
    <div className="h-full overflow-auto bg-background">
      {detailContent ? (
        <div className="h-full flex flex-col">
          {/* Mobile-only back button header */}
          <div className="flex-shrink-0 flex items-center h-12 px-2 border-b border-border lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSelectedId(null)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto">
            {detailContent}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <p>Select an item to view details</p>
        </div>
      )}
    </div>
  )
}

/**
 * Unified responsive shell — renders both mobile and desktop elements
 * in a single React tree. CSS visibility classes (`hidden lg:flex`, `lg:hidden`)
 * handle the responsive switch instead of conditional rendering, so the
 * component tree is never destroyed when crossing the 1024px breakpoint.
 */
function AppShellContent({ children }: AppShellProps) {
  const { hideNavbar } = useScrollNavbarContext()
  const { selectedId } = useDetailPanel()
  const isDesktop = useIsDesktop()

  // On mobile, show the overlay when an item is selected
  const showMobileOverlay = !isDesktop && !!selectedId

  return (
    <div className="relative h-[100dvh] w-full flex bg-background overflow-hidden pt-safe">
      {/* Sidebar — desktop only */}
      <div className="hidden lg:flex flex-shrink-0 h-full">
        <SidebarNav />
      </div>

      {/* Main content area with resizable panels */}
      <div className="flex-1 flex min-w-0 lg:overflow-x-auto">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="desktop-panel-layout"
          className="h-full lg:min-w-[750px]"
        >
          <ResizablePanel defaultSize={35} minSize={30} className="lg:min-w-[375px]">
            <div className="h-full flex flex-col overflow-hidden relative">{children}</div>
          </ResizablePanel>

          {/* Resize handle — desktop only */}
          <ResizableHandle withHandle className="hidden lg:flex" />

          {/* Detail panel — desktop only */}
          <ResizablePanel defaultSize={65} minSize={25} className="hidden lg:block">
            <DetailPanelContent />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Mobile detail overlay — shown when item is selected on mobile */}
      {showMobileOverlay && (
        <div className="fixed inset-0 z-[60] bg-background lg:hidden pt-safe">
          <DetailPanelContent />
        </div>
      )}

      {/* Sidebar toggle — desktop only */}
      <div className="hidden lg:block absolute left-3 z-[100] top-[calc(env(safe-area-inset-top)+0.875rem)]">
        <SidebarToggle />
      </div>

      {/* Bottom navbar — mobile only, hidden when overlay is active */}
      <div className={cn(
        "fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out lg:hidden",
        (hideNavbar || showMobileOverlay) ? "translate-y-full" : "translate-y-0"
      )}>
        <BottomNavbar />
      </div>

      <PWAInstallPrompt />
    </div>
  )
}

export function AppShell({ children }: AppShellProps) {
  return <AppShellContent>{children}</AppShellContent>
}
