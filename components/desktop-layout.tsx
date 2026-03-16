"use client"

import type React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { FlightForm } from "@/components/flight-form"
import { NavPill, NavPillLayout } from "@/components/nav-pill"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { mutate } from "swr"
import { CACHE_KEYS } from "@/hooks/data"
import { syncService } from "@/lib/sync"

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
 * Unified responsive shell.
 *
 * Mobile (<768px): Full-width content + floating bottom nav pill
 * Desktop (≥768px): Push sidebar (via NavPillLayout) + resizable split panels + floating top nav pill
 */
function AppShellContent({ children }: AppShellProps) {
  const { handleScroll } = useScrollNavbarContext()
  const { selectedId } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const searchParams = useSearchParams()

  // Only show mobile overlay when the selection is explicit (in URL via ?selected=).
  // SessionStorage-restored selections set state but don't update the URL,
  // so this prevents the overlay from auto-showing on page navigation.
  const showMobileOverlay = !isDesktop && !!selectedId && searchParams.has("selected")

  return (
    <div className="relative h-[100dvh] w-full flex bg-background overflow-hidden pt-safe">
      {/* NavPillLayout wraps content — on desktop it provides the push sidebar */}
      <NavPillLayout>
        {/* Main content area with resizable panels */}
        <div className="flex-1 flex min-w-0 md:overflow-x-auto h-full">
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="desktop-panel-layout"
            className="h-full md:min-w-[750px]"
          >
            <ResizablePanel defaultSize={35} minSize={30} className="md:min-w-[375px]">
              {/* md:pt-14 clears the floating top pill on desktop */}
              <div className="h-full flex flex-col overflow-hidden relative md:pt-14">{children}</div>
            </ResizablePanel>

            {/* Resize handle — desktop only */}
            <ResizableHandle withHandle className="hidden md:flex" />

            {/* Detail panel — desktop only */}
            <ResizablePanel defaultSize={65} minSize={25} className="hidden md:block">
              {isDesktop && <DetailPanelContent />}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </NavPillLayout>

      {/* Mobile detail overlay — sits above main content but behind the nav pill.
          z-[55] beats page headers (z-50), nav pill z-[60] wins. */}
      {showMobileOverlay && (
        <div
          className="fixed inset-0 z-[55] bg-background md:hidden pt-safe"
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

      {/* Floating nav pill — handles its own responsive positioning */}
      <NavPill />

      <PWAInstallPrompt />
    </div>
  )
}

export function AppShell({ children }: AppShellProps) {
  return <AppShellContent>{children}</AppShellContent>
}
