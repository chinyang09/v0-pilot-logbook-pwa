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
import { NavPill } from "@/components/nav-pill"
import { PushSidebar } from "@/components/push-sidebar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { GlassContainer } from "@/components/ui/glass-container"
import { usePageActions } from "@/hooks/use-page-actions"
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
 * Desktop (≥768px): Push sidebar + resizable split panels + floating top nav pill
 */
function AppShellContent({ children }: AppShellProps) {
  const { handleScroll } = useScrollNavbarContext()
  const { selectedId } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const searchParams = useSearchParams()
  const { mainActions, detailActions } = usePageActions()

  // Only show mobile overlay when the selection is explicit (in URL via ?selected=).
  // SessionStorage-restored selections set state but don't update the URL,
  // so this prevents the overlay from auto-showing on page navigation.
  const showMobileOverlay = !isDesktop && !!selectedId && searchParams.has("selected")

  return (
    <div className="relative h-[100dvh] w-full flex bg-background overflow-hidden pt-safe">
      {/* Push sidebar — desktop only, flex child that takes width and pushes panels right */}
      {isDesktop && <PushSidebar />}

      {/* Main content area with resizable panels */}
      <div className="flex-1 flex min-w-0 md:overflow-x-auto h-full">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="desktop-panel-layout"
          className="h-full md:min-w-[750px]"
        >
          <ResizablePanel defaultSize={35} minSize={30} className="md:min-w-[375px]">
            <div className="h-full flex flex-col overflow-hidden relative">{children}</div>
          </ResizablePanel>

          {/* Resize handle — desktop only */}
          <ResizableHandle withHandle className="hidden md:flex" />

          {/* Detail panel — desktop only */}
          <ResizablePanel defaultSize={65} minSize={25} className="hidden md:block">
            {isDesktop && <DetailPanelContent />}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

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

      {/* Floating action bar — desktop only.
          Main panel actions flush-left, detail panel actions flush-right,
          both inline with the centered nav pill. */}
      {isDesktop && (mainActions || detailActions) && (
        <div className="fixed z-[99] top-[calc(env(safe-area-inset-top,0px)+0.5rem)] left-0 right-0 pointer-events-none hidden md:flex items-start justify-between px-4">
          {/* Main panel actions — flush left */}
          <div className="pointer-events-auto">
            {mainActions && (
              <GlassContainer cornerRadius={22}>
                <div className="flex items-center gap-1 px-2 h-11">
                  {mainActions}
                </div>
              </GlassContainer>
            )}
          </div>

          {/* Detail panel actions — flush right */}
          <div className="pointer-events-auto">
            {detailActions && (
              <GlassContainer cornerRadius={22}>
                <div className="flex items-center gap-1 px-2 h-11">
                  {detailActions}
                </div>
              </GlassContainer>
            )}
          </div>
        </div>
      )}

      {/* Floating nav pill — pill only, sidebar is PushSidebar above */}
      <NavPill />

      <PWAInstallPrompt />
    </div>
  )
}

export function AppShell({ children }: AppShellProps) {
  return <AppShellContent>{children}</AppShellContent>
}
