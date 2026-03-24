"use client"

import type React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import type { ImperativePanelHandle } from "react-resizable-panels"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { FlightForm } from "@/components/flight-form"
import { useRef, useCallback, useEffect } from "react"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GlassContainer } from "@/components/ui/glass-container"
import { cn } from "@/lib/utils"
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
  const { selectedId, setSelectedId } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const { isOpen: sidebarOpen } = useSidebar()
  const searchParams = useSearchParams()
  const { mainActions, detailActions } = usePageActions()

  // Refs for scroll-to-top tap zones
  const mainPanelRef = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)

  // Imperative panel handle — used to maintain main panel pixel width on sidebar toggle
  const mainPanelHandleRef = useRef<ImperativePanelHandle>(null)
  const panelGroupContainerRef = useRef<HTMLDivElement>(null)
  const prevSidebarOpenRef = useRef(sidebarOpen)

  // When sidebar opens/closes, recalculate main panel % to keep its pixel width constant
  useEffect(() => {
    if (!isDesktop) return
    if (prevSidebarOpenRef.current === sidebarOpen) return

    const handle = mainPanelHandleRef.current
    const container = panelGroupContainerRef.current
    if (!handle || !container) {
      prevSidebarOpenRef.current = sidebarOpen
      return
    }

    // Capture pixel width before the container resizes
    const currentPercent = handle.getSize()
    const currentContainerWidth = container.offsetWidth
    const mainPixelWidth = currentContainerWidth * currentPercent / 100

    prevSidebarOpenRef.current = sidebarOpen

    // After sidebar animation completes (200ms), apply corrected percentage
    const timer = setTimeout(() => {
      const newContainerWidth = container.offsetWidth
      if (newContainerWidth <= 0) return
      const newPercent = (mainPixelWidth / newContainerWidth) * 100
      // Clamp to valid range
      handle.resize(Math.min(Math.max(newPercent, 30), 70))
    }, 220)
    return () => clearTimeout(timer)
  }, [sidebarOpen, isDesktop])

  const scrollMainToTop = useCallback(() => {
    // Find the first actually-scrollable element (scrollTop > 0 or has scroll overflow)
    const candidates = mainPanelRef.current?.querySelectorAll("[data-scroll-container], .overflow-y-auto, .overflow-auto")
    if (!candidates) return
    for (const el of candidates) {
      if (el.scrollTop > 0) { el.scrollTop = 0; return }
    }
    // If nothing is scrolled, scroll the first candidate anyway (resets position)
    if (candidates.length > 0) candidates[0].scrollTop = 0
  }, [])

  const scrollDetailToTop = useCallback(() => {
    const candidates = detailPanelRef.current?.querySelectorAll("[data-scroll-container], .overflow-y-auto, .overflow-auto")
    if (!candidates) return
    for (const el of candidates) {
      if (el.scrollTop > 0) { el.scrollTop = 0; return }
    }
    if (candidates.length > 0) candidates[0].scrollTop = 0
  }, [])

  // Only show mobile overlay when the selection is explicit (in URL via ?selected=).
  // SessionStorage-restored selections set state but don't update the URL,
  // so this prevents the overlay from auto-showing on page navigation.
  const showMobileOverlay = !isDesktop && !!selectedId && searchParams.has("selected")

  return (
    <div className="relative h-[100dvh] w-full flex flex-col bg-background overflow-hidden">
      {/* PWA install banner — in layout flow, pushes content down when visible */}
      <PWAInstallPrompt />

      <div className="flex-1 min-h-0 flex pt-safe">
      {/* Push sidebar — desktop only, pushes the whole panel group right */}
      {isDesktop && <PushSidebar />}

      {/* Main content area with resizable panels */}
      <div className="flex-1 min-w-0 h-full relative">
        {/* Header bar — progressive gradient overlay, visible on both mobile and desktop.
            Hidden on mobile when detail overlay is shown (detail overlay has its own header). */}
        <div
          className={cn(
            "absolute top-0 left-0 right-0 z-[99] flex cursor-pointer",
            showMobileOverlay && "hidden md:flex"
          )}
          style={{
            background: "linear-gradient(to bottom, var(--background) 0%, color-mix(in srgb, var(--background) 60%, transparent) 50%, transparent 100%)",
          }}
          onClick={scrollMainToTop}
        >
          <div className="flex items-center justify-between px-4 w-full h-16">
            {/* Main panel actions — flush left, stop propagation so buttons work */}
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              {mainActions}
            </div>

            {/* Spacer — taps fall through to parent scrollMainToTop */}
            <div className="flex-1 h-full" />

            {/* Nav pill placeholder — actual pill is fixed-positioned on top */}
            <div className="flex-shrink-0 w-0" />

            {/* Right spacer — desktop only, scrolls detail panel to top */}
            {isDesktop && (
              <div
                className="flex-1 h-full"
                onClick={(e) => { e.stopPropagation(); scrollDetailToTop() }}
              />
            )}

            {/* Detail panel actions — desktop only (mobile shows in overlay) */}
            {isDesktop && (
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                {detailActions}
              </div>
            )}
          </div>
        </div>

        {/* Resizable panels — full height, content scrolls behind absolute header */}
        <div ref={panelGroupContainerRef} className="h-full md:overflow-x-auto">
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="desktop-panel-layout"
            className="h-full md:min-w-[750px]"
          >
            <ResizablePanel ref={mainPanelHandleRef} defaultSize={35} minSize={30} className="md:min-w-[375px]">
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
          {/* Mobile detail header bar — gradient overlay with back button + detail actions */}
          <div
            className="absolute top-0 left-0 right-0 z-[99] flex pointer-events-none"
            style={{
              background: "linear-gradient(to bottom, var(--background) 0%, color-mix(in srgb, var(--background) 60%, transparent) 50%, transparent 100%)",
            }}
          >
            <div className="flex items-center justify-between px-4 w-full pointer-events-auto h-16">
              {/* Back button — flush left */}
              <GlassContainer cornerRadius={28}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-14 w-14"
                  onClick={() => {
                    // Remove ?selected= from URL to dismiss overlay
                    const url = new URL(window.location.href)
                    url.searchParams.delete("selected")
                    window.history.replaceState({}, "", url.toString())
                    setSelectedId(null)
                  }}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </GlassContainer>
              <div className="flex-1" />
              {/* Detail actions — flush right */}
              <div className="flex items-center gap-2">
                {detailActions}
              </div>
            </div>
          </div>
          <DetailPanelContent />
        </div>
      )}

      {/* Floating nav pill — always mounted, animates opacity based on sidebar state */}
      <NavPill />
      </div>
    </div>
  )
}

export function AppShell({ children }: AppShellProps) {
  return <AppShellContent>{children}</AppShellContent>
}
