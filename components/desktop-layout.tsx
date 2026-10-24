"use client"

import type React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop, useDesktopPill, useHydrated } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import type { ImperativePanelHandle } from "react-resizable-panels"
import { SINGLE_MONTH_PX, DUAL_MONTH_PX, DETAIL_MIN_PX } from "@/lib/layout/panel-widths"
import { setPanelDualMonth, useIsMainPanelFullWidth, useIsFloatingPanelUnderHeader } from "@/lib/layout/panel-mode"
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
import { BottomEdgeBlur } from "@/components/bottom-edge-blur"
import { ChromeFade } from "@/components/ui/chrome-overlays"
import { HeaderTitle } from "@/components/header-title"
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
/**
 * What an empty detail panel says, per page — the thing a row there opens.
 * It said "Select an item to view details" everywhere but the logbook, which
 * on Crew or Currencies left the reader to work out what an "item" was.
 */
const DETAIL_PLACEHOLDER: Record<string, string> = {
  "/": "Select a requirement or a flight",
  "/logbook": "Select a flight",
  "/aircraft": "Select an aircraft",
  "/airports": "Select an airport",
  "/crew": "Select a crew member",
  "/roster": "Select a duty or a day",
  "/currencies": "Select a currency",
  "/discrepancies": "Select a comparison or a note",
  "/fdp": "Open the Quick Check",
  "/recently-deleted": "Select a deleted item",
}
function detailPlaceholder(pathname: string | null): string {
  return (pathname && DETAIL_PLACEHOLDER[pathname]) || "Select an item to view details"
}

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
    <div className="h-full overflow-auto overscroll-contain bg-background">
      {!isLogbook && detailContent ? (
        <div className="h-full overflow-auto overscroll-contain">
          {detailContent}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <p>{detailPlaceholder(pathname)}</p>
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
  const { selectedId, setSelectedId, selectionExplicit } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const hydrated = useHydrated()
  // Sidebar UI (pill↔sidebar morph) exists only at the desktop-pill tier —
  // the push spacer and the width-lock must gate on the same breakpoint.
  const canPushSidebar = useDesktopPill()
  const { isOpen: sidebarOpen } = useSidebar()
  const searchParams = useSearchParams()
  const { mainActions, detailActions } = usePageActions()
  const mainFullWidth = useIsMainPanelFullWidth()
  const floatingPanelOpen = useIsFloatingPanelUnderHeader()

  // The main panel has exactly TWO widths — one calendar month or two. The
  // divider is a toggle rather than a drag handle: dragging it only ever
  // ended at one of these anyway, and on the way there the calendar grew
  // continuously and flipped layout mid-gesture, which looked broken.
  const [snapTrigger, setSnapTrigger] = useState(0)
  const [wantDualMonth, setWantDualMonth] = useState(false)

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
    // A page taking the whole width (`useMainPanelFullWidth`) has no main
    // width to hold — it IS the container. Locking it here capped the FDP
    // chart at the split's main width for the length of the morph, so it
    // shrank to the main panel and then sprang back to full width.
    if (mainFullWidth) {
      prevSidebarOpenRef.current = sidebarOpen
      return
    }

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
  }, [sidebarOpen, isDesktop, canPushSidebar, mainFullWidth])

  // Size the main panel to whichever of the two widths is selected. Runs on
  // toggle, on sidebar open/close and on container resize, so the panel is
  // always exactly one of them and never an in-between width.
  const [canFitDualMonth, setCanFitDualMonth] = useState(false)

  useEffect(() => {
    if (!isDesktop) return
    const container = panelGroupContainerRef.current
    const handle = mainPanelHandleRef.current
    if (!container || !handle) return

    const apply = () => {
      const containerWidth = container.offsetWidth
      if (containerWidth <= 0) return
      const availableWidth = containerWidth - HANDLE_WIDTH_PX
      const fitsDual = availableWidth >= DUAL_MONTH_PX + DETAIL_MIN_PX
      setCanFitDualMonth(fitsDual)

      const isDual = fitsDual && wantDualMonth
      // Published in the SAME callback that resizes the panel, so the calendar
      // switches mode in the same commit rather than a frame later off its own
      // ResizeObserver — that lag is what flashed the wrong-width calendar.
      setPanelDualMonth(isDual)
      const targetPx = isDual ? DUAL_MONTH_PX : SINGLE_MONTH_PX
      const targetPercent = (targetPx / availableWidth) * 100
      if (targetPercent >= 20 && targetPercent <= 80) {
        handle.resize(targetPercent)
      }
    }

    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(container)
    return () => ro.disconnect()
  }, [isDesktop, wantDualMonth, snapTrigger])

  // The header's main region spans the main PANEL, so it needs the panel's
  // width. Written as a CSS variable from the observer's own callback — after
  // layout, and without a React render for a value only CSS reads.
  const contentAreaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const panel = mainPanelRef.current
    const area = contentAreaRef.current
    if (!isDesktop || !panel || !area) return
    const ro = new ResizeObserver(([entry]) => {
      area.style.setProperty("--main-panel-w", `${Math.round(entry.contentRect.width)}px`)
    })
    ro.observe(panel)
    return () => ro.disconnect()
  }, [isDesktop])

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
    <div className="relative h-full w-full flex flex-col bg-background overflow-hidden">
      {/* PWA install banner — in layout flow, pushes content down when visible.
          It owns the status-bar inset while it is up; fixed surfaces read
          `--install-banner-height` / `--top-inset` (see the component). */}
      <PWAInstallPrompt />

      {/* Progressive blur toward the home indicator (iOS standalone only);
          z-40 keeps it under the nav pill, the sidebar and the overlays */}
      <BottomEdgeBlur />

      {/* No safe-area inset here on purpose — the panels run edge to edge and
          content scrolls UNDER the status bar. The inset lives inside each
          scroller (`.pt-chrome`) and on the header's gradient below. */}
      <div className="flex-1 min-h-0 flex">
      {/* Push sidebar — desktop only, pushes the whole panel group right */}
      {isDesktop && <PushSidebar />}

      {/* Main content area with resizable panels */}
      <div
        ref={contentAreaRef}
        className="header-regions flex-1 min-w-0 h-full relative"
        // The nav pill sits centred in the header row here, so the header's
        // regions keep clear of it (see `.header-regions` in globals.css).
        data-pill-top={canPushSidebar && !sidebarOpen ? "" : undefined}
      >
        {/* Header bar — progressive gradient overlay, visible on both mobile and desktop.
            Hidden on mobile when detail overlay is shown (detail overlay has its own header). */}
        <div
          className={cn(
            // `pt-chrome-bar` extends the treatment up over the status bar, so
            // content fades out beneath it instead of stopping at a hard edge.
            "absolute top-0 left-0 right-0 z-[99] flex pt-chrome-bar",
            showMobileOverlay && "hidden md:flex"
          )}
        >
          {/* The one floating-header treatment: progressive blur + fade */}
          {/* …with its tail cleared over the main panel while a floating
              panel hangs there (see `useFloatingPanelUnderHeader`). */}
          <ChromeFade
            side="top"
            clearBelowBar={floatingPanelOpen ? (isDesktop ? "var(--main-panel-w)" : "100%") : undefined}
          />

          {/* FAST-SCROLL BAND — the strip just BELOW the action buttons.
              iOS's own "tap the status bar to go to the top" target is the
              status bar, which is genuinely not part of the scroll view; ours
              was only the `h-13` row, so aiming a little low landed on a
              flight card and opened it instead. This claims the band under
              the buttons, where the treatment is already darkening and the
              content is already chrome-ward.

              It is a REAL element, so a drag started inside it does not
              scroll the list — that is the trade, and why it stays thin
              (`--chrome-tap`, 24px) rather than covering the whole fade tail.
              Below the buttons only: the buttons themselves sit above it. */}
          {/* Steps aside while a floating panel sits in this band (the
              logbook's search or calendar), or it swallows that panel's own
              first control — see `useFloatingPanelUnderHeader`. */}
          {!floatingPanelOpen && (
            <div
              aria-hidden
              className="absolute inset-x-0 z-0 cursor-pointer"
              style={{ top: "var(--chrome-top)", height: "var(--chrome-tap)" }}
              onClick={scrollMainToTop}
            />
          )}
          <div className="relative z-[1] flex items-center px-4 w-full h-13">
            {/* MAIN region — over the main panel (see `--header-main-w`): its
                actions, then the page's title once it has scrolled under the
                bar (`.header-bar-grid` centres it when there is room and gives
                the buttons their width first when there is not). On a phone it
                is the whole row. Tapping any bare part scrolls the main panel
                to the top. */}
            <div
              className="header-bar-grid h-full min-w-0 cursor-pointer"
              style={isDesktop ? { width: "var(--header-main-w)", flex: "none" } : { flex: "1 1 0%" }}
              onClick={(e) => { if (e.target === e.currentTarget) scrollMainToTop() }}
            >
              <div
                className="flex items-center gap-2 min-w-0 h-full"
                onClick={(e) => { if (e.target === e.currentTarget) scrollMainToTop() }}
              >
                {mainActions}
              </div>
              <HeaderTitle slot="main" onClick={scrollMainToTop} />
              <div aria-hidden className="h-full" onClick={scrollMainToTop} />
            </div>

            {/* DETAIL region — desktop only (mobile shows it in the overlay):
                the open record's title when it has scrolled away, then its
                commits flush right. Its first column keeps clear of the nav
                pill when the pill sits in this row (`--detail-pill-clear`). */}
            {isDesktop && (
              <div
                className="header-bar-grid header-bar-grid-detail flex-1 h-full min-w-0 cursor-pointer"
                onClick={(e) => { if (e.target === e.currentTarget) scrollDetailToTop() }}
              >
                <div aria-hidden className="h-full" onClick={scrollDetailToTop} />
                <HeaderTitle slot="detail" onClick={scrollDetailToTop} />
                <div aria-hidden className="h-full" onClick={scrollDetailToTop} />
                <div
                  className="flex items-center justify-end gap-2 h-full"
                  onClick={(e) => { if (e.target === e.currentTarget) scrollDetailToTop() }}
                >
                  {detailActions}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Resizable panels — full height, content scrolls behind absolute header */}
        {/* `data-main-full`: the page on screen wants the main panel to take
            the whole width (`useMainPanelFullWidth`) — the detail panel and
            the divider step aside, and come back with their sizes intact. */}
        <div
          ref={panelGroupContainerRef}
          className="h-full md:overflow-x-auto"
          data-main-full={isDesktop && mainFullWidth ? "" : undefined}
        >
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="desktop-panel-layout"
            // 720 = SPLIT_MIN_PX (two phone-width panels); see lib/layout/panel-widths.
            className="h-full md:min-w-[720px]"
          >
            {/* 360 = SINGLE_MONTH_PX. `minSize` is a PERCENT, so it has to stay low
                enough that 360px is reachable — the real floor is this min-width. */}
            <ResizablePanel ref={mainPanelHandleRef} defaultSize={35} minSize={20} className="split-main md:min-w-[360px]">
              <div ref={mainPanelRef} className="h-full flex flex-col overflow-hidden relative">
                {children}
              </div>
            </ResizablePanel>

            {/* Resize handle — desktop only, snaps to mobile-width multiples */}
            <ResizableHandle
              disabled
              className="split-handle hidden md:flex"
              toggle={canFitDualMonth ? () => setWantDualMonth((v) => !v) : undefined}
              toggleLabel={wantDualMonth ? "Narrow the list panel" : "Widen the list panel"}
              toggleActive={wantDualMonth}
            />

            {/* Detail panel — desktop only. Pre-hydration, `isDesktop` is
                forced false (server snapshot) while the CSS `md:` panel is
                already visible — without the placeholder the panel painted as
                a bare void until hydration. The placeholder is display:none'd
                by the same md: rule on phones, so it costs nothing there. */}
            {/* 360 = DETAIL_MIN_PX — the detail pane stays at least a phone wide. */}
            <ResizablePanel defaultSize={65} minSize={20} className="split-detail hidden md:block md:min-w-[360px]">
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
          // Below the install banner (a browser tab only), like the rest of
          // the shell: `inset-0` slid the overlay's header under it.
          className="fixed inset-x-0 bottom-0 top-[var(--install-banner-height)] z-[55] bg-background md:hidden"
        >
          {/* Mobile detail header bar — gradient overlay with back button + detail actions */}
          <div className="absolute top-0 left-0 right-0 z-[99] flex pointer-events-none pt-chrome-bar">
            {/* Same header treatment as the main shell */}
            <ChromeFade side="top" />
            <div className="header-bar-grid header-bar-grid-balanced relative z-[1] px-4 w-full pointer-events-auto h-13">
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
              {/* The record's title once it has scrolled away — centred
                  between Back and the commits, and never under either. */}
              <HeaderTitle slot="detail" onClick={scrollMobileDetailToTop} />
              {/* Detail actions — flush right */}
              <div className="flex items-center justify-end gap-2">
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
