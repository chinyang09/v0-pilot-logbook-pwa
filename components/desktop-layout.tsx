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
import { useRef, useCallback } from "react"
import { NavPill } from "@/components/nav-pill"
import { PushSidebar } from "@/components/push-sidebar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
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

  // Refs for scroll-to-top tap zones
  const mainPanelRef = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)

  const scrollMainToTop = useCallback(() => {
    const el = mainPanelRef.current?.querySelector("[data-scroll-container], main, .overflow-y-auto, .overflow-auto")
    if (el) el.scrollTop = 0
  }, [])

  const scrollDetailToTop = useCallback(() => {
    const el = detailPanelRef.current?.querySelector("[data-scroll-container], main, .overflow-y-auto, .overflow-auto")
    if (el) el.scrollTop = 0
  }, [])

  // Only show mobile overlay when the selection is explicit (in URL via ?selected=).
  // SessionStorage-restored selections set state but don't update the URL,
  // so this prevents the overlay from auto-showing on page navigation.
  const showMobileOverlay = !isDesktop && !!selectedId && searchParams.has("selected")

  return (
    <div className="relative h-[100dvh] w-full flex bg-background overflow-hidden pt-safe">
      {/* Push sidebar — desktop only, flex child that takes width and pushes panels right */}
      {isDesktop && <PushSidebar />}

      {/* Main content area with resizable panels */}
      <div className="flex-1 min-w-0 h-full relative">
        {/* Header bar — progressive dark-to-transparent gradient so content fades in as it scrolls up */}
        {isDesktop && (
          <div
            className="absolute top-0 left-0 right-0 z-[99] hidden md:flex pointer-events-none"
            style={{
              background: "linear-gradient(to bottom, var(--background) 0%, color-mix(in srgb, var(--background) 60%, transparent) 50%, transparent 100%)",
            }}
          >
            <div className="flex items-center justify-between px-4 w-full pointer-events-auto" style={{ height: "calc(3.5rem + env(safe-area-inset-top, 0px) + 0.5rem)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}>
              {/* Main panel actions — flush left */}
              <div className="flex items-center gap-2">
                {mainActions}
              </div>

              {/* Tap zone left of pill — scrolls main panel to top */}
              <div
                className="flex-1 h-full cursor-pointer"
                onClick={scrollMainToTop}
              />

              {/* Nav pill placeholder — actual pill is fixed-positioned on top */}
              <div className="flex-shrink-0 w-0" />

              {/* Tap zone right of pill — scrolls detail panel to top */}
              <div
                className="flex-1 h-full cursor-pointer"
                onClick={scrollDetailToTop}
              />

              {/* Detail panel actions — flush right */}
              <div className="flex items-center gap-2">
                {detailActions}
              </div>
            </div>
          </div>
        )}

        {/* Resizable panels — full height, content scrolls behind absolute header */}
        <div className="h-full md:overflow-x-auto">
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="desktop-panel-layout"
            className="h-full md:min-w-[750px]"
          >
            <ResizablePanel defaultSize={35} minSize={30} className="md:min-w-[375px]">
              <div ref={mainPanelRef} className="h-full flex flex-col overflow-hidden relative">
                {children}
              </div>
            </ResizablePanel>

            {/* Resize handle — desktop only */}
            <ResizableHandle withHandle className="hidden md:flex" />

            {/* Detail panel — desktop only */}
            <ResizablePanel defaultSize={65} minSize={25} className="hidden md:block">
              <div ref={detailPanelRef} className="h-full">
                {isDesktop && <DetailPanelContent />}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
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

      {/* Floating nav pill — always mounted, animates opacity based on sidebar state */}
      <NavPill />

      <PWAInstallPrompt />
    </div>
  )
}

export function AppShell({ children }: AppShellProps) {
  return <AppShellContent>{children}</AppShellContent>
}
