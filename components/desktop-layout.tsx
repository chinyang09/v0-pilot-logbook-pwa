"use client"

import type React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useIsDesktop, useCanPushSidebar } from "@/hooks/use-is-desktop"
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
 * Breakpoints (all min-widths):
 *   ≥1200px: Push sidebar (220) + dual-month main (≥620) + detail (≥360)
 *   ≥ 940px: Push sidebar (220) + main (≥360) + detail (≥360)
 *   ≥ 720px: Overlay sidebar + main (≥360) + detail (≥360)
 *   < 720px: Mobile — single panel + bottom pill + overlay sidebar
 */
function AppShellContent({ children }: AppShellProps) {
  const { handleScroll } = useScrollNavbarContext()
  const { selectedId, setSelectedId } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const canPushSidebar = useCanPushSidebar()
  const { isOpen: sidebarOpen } = useSidebar()
  const searchParams = useSearchParams()
  const { mainActions, detailActions } = usePageActions()

  // Panel snap state — snaps main panel to 360px or 720px on drag end or sidebar toggle
  const [isDragging, setIsDragging] = useState(false)
  const [snapTrigger, setSnapTrigger] = useState(0)

  // Refs for scroll-to-top tap zones
  const mainPanelRef = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)

  // Imperative panel handle — used to maintain main panel pixel width on sidebar toggle
  const mainPanelHandleRef = useRef<ImperativePanelHandle>(null)
  const panelGroupContainerRef = useRef<HTMLDivElement>(null)
  const prevSidebarOpenRef = useRef(sidebarOpen)
  const targetMainPixelWidthRef = useRef(0)

  // When sidebar opens/closes, lock the main panel's pixel width and continuously
  // recalculate its percentage via ResizeObserver so it never visually shrinks/grows.
  // Only needed when the sidebar pushes content (wide desktop ≥ 940px).
  useEffect(() => {
    if (!isDesktop || !canPushSidebar) return
    if (prevSidebarOpenRef.current === sidebarOpen) return

    const handle = mainPanelHandleRef.current
    const container = panelGroupContainerRef.current
    if (!handle || !container) {
      prevSidebarOpenRef.current = sidebarOpen
      return
    }

    // Capture pixel width before the container starts resizing
    const currentPercent = handle.getSize()
    const currentContainerWidth = container.offsetWidth
    targetMainPixelWidthRef.current = currentContainerWidth * currentPercent / 100

    prevSidebarOpenRef.current = sidebarOpen

    // Observe container width changes during the sidebar animation and
    // recalculate main panel % on every frame to keep its pixel width constant.
    const observer = new ResizeObserver(() => {
      const target = targetMainPixelWidthRef.current
      if (target <= 0) return
      const newWidth = container.offsetWidth
      if (newWidth <= 0) return
      const newPercent = (target / newWidth) * 100
      handle.resize(Math.min(Math.max(newPercent, 30), 70))
    })
    observer.observe(container)

    // Stop observing after animation settles (200ms sidebar + buffer),
    // then trigger a snap so the main panel lands on 360px or 720px.
    const timer = setTimeout(() => {
      observer.disconnect()
      targetMainPixelWidthRef.current = 0
      setSnapTrigger(c => c + 1)
    }, 300)

    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [sidebarOpen, isDesktop, canPushSidebar])

  // Snap main panel to nearest mobile-width multiple (375px or 750px) on drag end
  useEffect(() => {
    if (isDragging || !isDesktop) return
    const container = panelGroupContainerRef.current
    const handle = mainPanelHandleRef.current
    if (!container || !handle) return

    const containerWidth = container.offsetWidth
    if (containerWidth <= 0) return

    const PANEL_WIDTH = 360
    const snapPoints = [PANEL_WIDTH, PANEL_WIDTH * 2]
    const currentPx = (containerWidth * handle.getSize()) / 100
    const closest = snapPoints.reduce((prev, curr) =>
      Math.abs(curr - currentPx) < Math.abs(prev - currentPx) ? curr : prev
    )
    const targetPercent = (closest / containerWidth) * 100

    // Only snap if within a reasonable range (20%-80%)
    if (targetPercent >= 20 && targetPercent <= 80) {
      handle.resize(targetPercent)
    }
  }, [isDragging, isDesktop, snapTrigger])

  const smoothScrollToTop = useCallback((container: React.RefObject<HTMLDivElement | null>) => {
    const candidates = container.current?.querySelectorAll("[data-scroll-container], .overflow-y-auto, .overflow-auto")
    if (!candidates) return
    let target: Element | null = null
    for (const el of candidates) {
      if (el.scrollTop > 0) { target = el; break }
    }
    if (!target && candidates.length > 0) target = candidates[0]
    if (!target) return
    const start = target.scrollTop
    if (start === 0) return
    const duration = 300
    const startTime = performance.now()
    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      target!.scrollTop = start * (1 - ease)
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [])

  const scrollMainToTop = useCallback(() => smoothScrollToTop(mainPanelRef), [smoothScrollToTop])
  const scrollDetailToTop = useCallback(() => smoothScrollToTop(detailPanelRef), [smoothScrollToTop])

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
            {/* Main panel actions — flush left on desktop, full-width on mobile for search expansion */}
            <div className="flex items-center gap-2 md:flex-none flex-1 min-w-0" onClick={e => e.stopPropagation()}>
              {mainActions}
            </div>

            {/* Spacer — taps fall through to parent scrollMainToTop (desktop only, mobile actions fill width) */}
            <div className="hidden md:block flex-1 h-full" />

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
            className="h-full md:min-w-[720px]"
          >
            <ResizablePanel ref={mainPanelHandleRef} defaultSize={35} minSize={30} className="md:min-w-[360px]">
              <div ref={mainPanelRef} className="h-full flex flex-col overflow-hidden relative">
                {children}
              </div>
            </ResizablePanel>

            {/* Resize handle — desktop only, snaps to mobile-width multiples */}
            <ResizableHandle withHandle className="hidden md:flex" onDragging={setIsDragging} />

            {/* Detail panel — desktop only */}
            <ResizablePanel defaultSize={65} minSize={20} className="hidden md:block md:min-w-[360px]">
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
