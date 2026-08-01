"use client"

import type React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useIsDesktop, useDesktopPill, useHydrated } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import type { ImperativePanelHandle } from "react-resizable-panels"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { FlightForm } from "@/components/flight-form"
import { useRef, useCallback, useEffect, useState } from "react"
import { ChevronLeft } from "lucide-react"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { cn } from "@/lib/utils"
import { NavPill } from "@/components/nav-pill"
import { PushSidebar } from "@/components/push-sidebar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { usePageActions } from "@/hooks/use-page-actions"
import { mutate } from "swr"
import { CACHE_KEYS } from "@/hooks/data"
import { syncService } from "@/lib/sync"
import { findVisibleScrollTarget, smoothScrollElementToTop } from "@/lib/utils/scroll"

/** Layout width of ResizableHandle (w-px) — used to convert between pixel widths and panel percentages */
const HANDLE_WIDTH_PX = 1

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
 * Breakpoints (all min-widths):
 *   ≥1120px: Desktop pill morph (top center / sidebar) + push spacer when open
 *   ≥ 720px: Split panels (main + detail); bottom pill + overlay sidebar until 1120
 *   < 720px: Mobile — single panel + bottom pill + overlay sidebar
 */
function AppShellContent({ children }: AppShellProps) {
  const { handleScroll } = useScrollNavbarContext()
  const { selectedId, setSelectedId, selectionExplicit } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const hydrated = useHydrated()
  // Sidebar UI (pill↔sidebar morph) exists only at the desktop-pill tier —
  // the push spacer and the width-lock must gate on the same breakpoint.
  const canPushSidebar = useDesktopPill()
  const { isOpen: sidebarOpen } = useSidebar()
  const searchParams = useSearchParams()
  const { mainActions, detailActions } = usePageActions()

  // Panel snap state — snaps main panel to 360px or 620px on drag end or sidebar toggle
  const [isDragging, setIsDragging] = useState(false)
  const [snapTrigger, setSnapTrigger] = useState(0)

  // Refs for scroll-to-top tap zones
  const mainPanelRef = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)
  const overlayPanelRef = useRef<HTMLDivElement>(null)

  // Imperative panel handle — used to maintain main panel pixel width on sidebar toggle
  const mainPanelHandleRef = useRef<ImperativePanelHandle>(null)
  const panelGroupContainerRef = useRef<HTMLDivElement>(null)
  const prevSidebarOpenRef = useRef(sidebarOpen)

  // When sidebar opens/closes, CSS-lock the main panel's pixel width so it
  // cannot visually resize during the sidebar animation (200ms).
  // Uses min-width/max-width which are hard flexbox constraints — the panel
  // physically stays at the locked width while the detail panel absorbs the change.
  // Only needed when the sidebar pushes content (wide desktop ≥ 920px).
  useEffect(() => {
    if (!isDesktop || !canPushSidebar) return
    if (prevSidebarOpenRef.current === sidebarOpen) return

    const handle = mainPanelHandleRef.current
    const container = panelGroupContainerRef.current
    if (!handle || !container) {
      prevSidebarOpenRef.current = sidebarOpen
      return
    }

    // Get the ResizablePanel DOM element (parent of the inner content div)
    const mainPanelEl = mainPanelRef.current?.parentElement
    if (!mainPanelEl) {
      prevSidebarOpenRef.current = sidebarOpen
      return
    }

    // Capture current pixel width before container starts resizing
    const currentPercent = handle.getSize()
    const currentContainerWidth = container.offsetWidth
    const pixelWidth = (currentContainerWidth - HANDLE_WIDTH_PX) * currentPercent / 100

    // CSS lock — prevents any visual change during sidebar animation
    mainPanelEl.style.minWidth = `${pixelWidth}px`
    mainPanelEl.style.maxWidth = `${pixelWidth}px`

    prevSidebarOpenRef.current = sidebarOpen

    // After sidebar animation settles (200ms + buffer), sync library state and unlock
    const timer = setTimeout(() => {
      const newContainerWidth = container.offsetWidth
      const newAvailable = newContainerWidth - HANDLE_WIDTH_PX
      const newPercent = (pixelWidth / newAvailable) * 100
      const clampedPercent = Math.min(Math.max(newPercent, 30), 70)

      // Update library's internal percentage to match the locked pixel width
      handle.resize(clampedPercent)

      // Remove CSS locks after library has applied new flex-basis, then snap
      requestAnimationFrame(() => {
        mainPanelEl.style.minWidth = ''
        mainPanelEl.style.maxWidth = ''
        setSnapTrigger(c => c + 1)
      })
    }, 300)

    return () => {
      clearTimeout(timer)
      if (mainPanelEl) {
        mainPanelEl.style.minWidth = ''
        mainPanelEl.style.maxWidth = ''
      }
    }
  }, [sidebarOpen, isDesktop, canPushSidebar])

  // Snap main panel to 360px (single month) or 620px (dual month) on drag end
  useEffect(() => {
    if (isDragging || !isDesktop) return
    const container = panelGroupContainerRef.current
    const handle = mainPanelHandleRef.current
    if (!container || !handle) return

    const containerWidth = container.offsetWidth
    if (containerWidth <= 0) return

    const SINGLE_MONTH = 360
    const DUAL_MONTH = 620
    const DETAIL_MIN = 360

    // Available width for panels (container minus handle)
    const availableWidth = containerWidth - HANDLE_WIDTH_PX

    // Only offer dual-month snap if container can fit both panels
    const canFitDualMonth = availableWidth >= DUAL_MONTH + DETAIL_MIN
    const snapPoints = canFitDualMonth
      ? [SINGLE_MONTH, DUAL_MONTH]
      : [SINGLE_MONTH]

    const currentPx = (availableWidth * handle.getSize()) / 100
    const closest = snapPoints.reduce((prev, curr) =>
      Math.abs(curr - currentPx) < Math.abs(prev - currentPx) ? curr : prev
    )
    const targetPercent = (closest / availableWidth) * 100

    // Only snap if within a reasonable range (20%-80%)
    if (targetPercent >= 20 && targetPercent <= 80) {
      handle.resize(targetPercent)
    }
  }, [isDragging, isDesktop, snapTrigger])

  const smoothScrollToTop = useCallback((container: React.RefObject<HTMLDivElement | null>) => {
    // Scope to the given panel and skip mounted-but-hidden keep-alive pages so we
    // scroll the container the user is actually looking at.
    const target = container.current ? findVisibleScrollTarget(container.current) : null
    if (target) smoothScrollElementToTop(target)
  }, [])

  const scrollMainToTop = useCallback(() => smoothScrollToTop(mainPanelRef), [smoothScrollToTop])
  const scrollDetailToTop = useCallback(() => smoothScrollToTop(detailPanelRef), [smoothScrollToTop])
  const scrollMobileDetailToTop = useCallback(() => smoothScrollToTop(overlayPanelRef), [smoothScrollToTop])

  // Show the mobile overlay when the selection is explicit. Two signals:
  // - `selectionExplicit` (state): the user tapped/created something THIS
  //   session — open immediately, without waiting for the router.replace URL
  //   round-trip (which can be slow/dropped on a phone while desktop renders
  //   from state — that asymmetry made the logbook [+] look dead on mobile).
  // - `?selected=` in the URL: deep links / reloads.
  // SessionStorage-restored selections set neither, so navigating back to a
  // page still doesn't auto-open the overlay.
  const showMobileOverlay =
    !isDesktop && !!selectedId && (selectionExplicit || searchParams.has("selected"))

  return (
    <div className="relative h-[100dvh] w-full flex flex-col bg-background overflow-hidden">
      {/* PWA install banner — in layout flow, pushes content down when visible */}
      <PWAInstallPrompt />

      {/* No safe-area inset here on purpose — the panels run edge to edge and
          content scrolls UNDER the status bar. The inset lives inside each
          scroller (`.pt-chrome`) and on the header's gradient below. */}
      <div className="flex-1 min-h-0 flex">
      {/* Push sidebar — desktop only, pushes the whole panel group right */}
      {isDesktop && <PushSidebar />}

      {/* Main content area with resizable panels */}
      <div className="flex-1 min-w-0 h-full relative">
        {/* Header bar — progressive gradient overlay, visible on both mobile and desktop.
            Hidden on mobile when detail overlay is shown (detail overlay has its own header). */}
        <div
          className={cn(
            // `pt-chrome-bar` extends the header up over the status bar and
            // `chrome-header-fade` keeps that strip see-through, so content
            // passing underneath is visible rather than painted out.
            "absolute top-0 left-0 right-0 z-[99] flex pt-chrome-bar chrome-header-fade",
            showMobileOverlay && "hidden md:flex"
          )}
        >
          <div className="flex items-center px-4 w-full h-16">
            {/* Main panel actions — flush left on desktop, fills width on mobile (for
                search expansion). Tapping its bare area scrolls the main panel to top
                (the e.target===currentTarget guard excludes the action buttons). */}
            <div
              className="flex items-center gap-2 md:flex-none flex-1 min-w-0 h-full cursor-pointer"
              onClick={(e) => { if (e.target === e.currentTarget) scrollMainToTop() }}
            >
              {mainActions}
            </div>

            {/* Main fall-through strip — desktop only (on mobile the main wrapper above
                owns the slack); tapping it scrolls the main panel to top. */}
            <div
              className="hidden md:block flex-1 h-full cursor-pointer"
              onClick={(e) => { if (e.target === e.currentTarget) scrollMainToTop() }}
            />

            {/* Nav pill placeholder — actual pill is fixed-positioned on top */}
            <div className="flex-shrink-0 w-0" />

            {/* Detail fall-through zone — desktop only; tapping it scrolls the detail panel to top */}
            {isDesktop && (
              <div
                className="flex-1 h-full cursor-pointer"
                onClick={(e) => { if (e.target === e.currentTarget) scrollDetailToTop() }}
              />
            )}

            {/* Detail panel actions — desktop only (mobile shows in overlay) */}
            {isDesktop && (
              <div className="flex items-center gap-2 h-full">
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
            className="h-full md:min-w-[720px]"
          >
            <ResizablePanel ref={mainPanelHandleRef} defaultSize={35} minSize={30} className="md:min-w-[360px]">
              <div ref={mainPanelRef} className="h-full flex flex-col overflow-hidden relative">
                {children}
              </div>
            </ResizablePanel>

            {/* Resize handle — desktop only, snaps to mobile-width multiples */}
            <ResizableHandle withHandle className="hidden md:flex" onDragging={setIsDragging} />

            {/* Detail panel — desktop only. Pre-hydration, `isDesktop` is
                forced false (server snapshot) while the CSS `md:` panel is
                already visible — without the placeholder the panel painted as
                a bare void until hydration. The placeholder is display:none'd
                by the same md: rule on phones, so it costs nothing there. */}
            <ResizablePanel defaultSize={65} minSize={20} className="hidden md:block md:min-w-[360px]">
              <div ref={detailPanelRef} className="h-full">
                {isDesktop ? (
                  <DetailPanelContent />
                ) : !hydrated ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground bg-background">
                    <p>Select an item to view details</p>
                  </div>
                ) : null}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>

      {/* Mobile detail overlay — sits above main content but behind the nav pill.
          z-[55] beats page headers (z-50), nav pill z-[60] wins. */}
      {showMobileOverlay && (
        <div
          ref={overlayPanelRef}
          className="fixed inset-0 z-[55] bg-background md:hidden"
          onScrollCapture={(e) => {
            const target = e.target as HTMLElement
            if (target !== e.currentTarget) {
              handleScroll({ currentTarget: target } as React.UIEvent<HTMLElement>)
            }
          }}
        >
          {/* Mobile detail header bar — gradient overlay with back button + detail actions */}
          <div
            className="absolute top-0 left-0 right-0 z-[99] flex pointer-events-none pt-chrome-bar chrome-header-fade"
          >
            <div className="flex items-center justify-between px-4 w-full pointer-events-auto h-16">
              {/* Back button — flush left */}
              <GlassIconButton
                ariaLabel="Back"
                // Just clear the selection — the detail panel provider owns
                // the URL and the history entry it pushed when this opened, and
                // consumes it with router.back(). Rewriting the URL here with
                // replaceState left that entry stranded, so the next system
                // back press did nothing.
                onClick={() => setSelectedId(null)}
              >
                  <ChevronLeft className="h-5 w-5" />
              </GlassIconButton>
              {/* Fall-through zone — tapping its bare area scrolls the detail overlay to top */}
              <div
                className="flex-1 h-full cursor-pointer"
                onClick={(e) => { if (e.target === e.currentTarget) scrollMobileDetailToTop() }}
              />
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
