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
  const isLogbook = pathname?.includes("/logbook")
  const isPickerPage = pathname?.includes("/aircraft") || pathname?.includes("/airports") || pathname?.includes("/crew")
  const flightId = (isLogbook && selectedId) ? selectedId : (isPickerPage && pickerFlightId) ? pickerFlightId : null

  // Show FlightForm when we have a flight to edit (either on logbook or during picker navigation)
  if (flightId) {
    return (
      <div className="h-full overflow-hidden bg-background">
        <FlightForm
          flightId={flightId}
          isDesktop={isDesktop}
          onFlightAdded={() => {
            // Background revalidation — no await so the UI isn't blocked
            mutate(CACHE_KEYS.flights)
            mutate(CACHE_KEYS.stats)
            if (navigator.onLine) {
              syncService.fullSync()
            }
          }}
          onClose={() => {
            mutate(CACHE_KEYS.flights) // background revalidation
            setSelectedId(null)
          }}
        />
      </div>
    )
  }

  // Other pages: fall back to context-provided content.
  // Logbook uses the Smart Switcher pattern and never sets detailContent, so skip the
  // fallback for logbook to prevent stale aircraft/airport/crew panels from bleeding in.
  return (
    <div className="h-full overflow-auto bg-background">
      {!isLogbook && detailContent ? (
        <div className="h-full overflow-auto">
          {detailContent}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <p>{isLogbook ? "Select a flight to view details" : "Select an item to view details"}</p>
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
  const { hideNavbar, handleScroll } = useScrollNavbarContext()
  const { selectedId } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const searchParams = useSearchParams()

  // Only show mobile overlay when the selection is explicit (in URL via ?selected=).
  // SessionStorage-restored selections set state but don't update the URL,
  // so this prevents the overlay from auto-showing on page navigation.
  const showMobileOverlay = !isDesktop && !!selectedId && searchParams.has("selected")

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
            {isDesktop && <DetailPanelContent />}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Mobile detail overlay — sits above main content but behind the bottom
          navbar so content scrolls under the frosted-glass bar, identical to
          the main page. z-[55] beats page headers (z-50), navbar z-[60] wins. */}
      {showMobileOverlay && (
        <div
          className="fixed inset-0 z-[55] bg-background lg:hidden pt-safe"
          onScrollCapture={(e) => {
            const target = e.target as HTMLElement
            if (target !== e.currentTarget) {
              handleScroll({ currentTarget: target } as React.UIEvent<HTMLElement>)
            }
          }}
        >
          <DetailPanelContent />
        </div>
      )}

      {/* Sidebar toggle — desktop only, centered in h-12 header and aligned with sidebar nav icons */}
      <div className="hidden lg:block absolute left-4 z-[100] top-[calc(env(safe-area-inset-top)+0.5rem)]">
        <SidebarToggle />
      </div>

      {/* Bottom navbar — mobile only, z-[60] sits above the detail overlay */}
      <div className={cn(
        "fixed bottom-0 left-0 right-0 z-[60] transition-[translate] duration-300 ease-in-out lg:hidden",
        hideNavbar ? "translate-y-full" : "translate-y-0"
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
