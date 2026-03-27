"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { useReducedMotion } from "framer-motion"
import {
  LayoutDashboard,
  Book,
  Calendar,
  Plane,
  Users,
  MapPin,
  Award,
  Settings,
  UserCircle,
  PanelLeft,
  Cloud,
  CloudOff,
  Loader2,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassContainer } from "@/components/ui/glass-container"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { usePreferences } from "@/components/providers/preferences-provider"
import { navSections, dashboardNavItem } from "@/components/nav-sections"
import { useSyncStatus, useSyncTrigger } from "@/hooks/sync/use-sync-status"
import type { BottomNavTab } from "@/types/db/stores.types"

// ─── Tab config ──────────────────────────────────────────────

const TAB_CONFIG: Record<
  BottomNavTab,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    href: string
    isActive: (pathname: string) => boolean
  }
> = {
  dashboard: {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
    isActive: (p) => p === "/",
  },
  logbook: {
    label: "Logbook",
    icon: Book,
    href: "/logbook",
    isActive: (p) => p === "/logbook" || p?.startsWith("/flights/"),
  },
  roster: {
    label: "Roster",
    icon: Calendar,
    href: "/roster",
    isActive: (p) =>
      p === "/roster" ||
      p === "/currencies" ||
      p === "/discrepancies" ||
      p === "/fdp",
  },
  aircraft: {
    label: "Aircraft",
    icon: Plane,
    href: "/aircraft",
    isActive: (p) => p === "/aircraft" || p?.startsWith("/aircraft/"),
  },
  crew: {
    label: "Crew",
    icon: Users,
    href: "/crew",
    isActive: (p) => p === "/crew" || p?.startsWith("/crew/"),
  },
  airports: {
    label: "Airports",
    icon: MapPin,
    href: "/airports",
    isActive: (p) => p === "/airports" || p?.startsWith("/airports/"),
  },
  currencies: {
    label: "Currencies",
    icon: Award,
    href: "/currencies",
    isActive: (p) => p === "/currencies",
  },
  settings: {
    label: "Settings",
    icon: Settings,
    href: "/settings",
    isActive: (p) => p === "/settings",
  },
  account: {
    label: "Account",
    icon: UserCircle,
    href: "/account",
    isActive: (p) => p === "/account",
  },
}

// ─── Constants ───────────────────────────────────────────────

const SIDEBAR_WIDTH = 288
const SIDEBAR_MARGIN = 4 // distance from viewport edge when expanded
const SIDEBAR_INNER_WIDTH = SIDEBAR_WIDTH - SIDEBAR_MARGIN * 2 // 280
const PILL_HEIGHT = 56 // h-14
const PILL_TOP = SIDEBAR_MARGIN // top offset — aligns pill center with header center

// ─── Sync status icon ────────────────────────────────────────

function SyncIconButton({ className }: { className?: string }) {
  const { status, isSyncing: statusSyncing } = useSyncStatus()
  const { triggerSync, isSyncing: triggerSyncing } = useSyncTrigger()
  const syncing = statusSyncing || triggerSyncing

  const handleSync = () => {
    if (!syncing && status !== "offline") triggerSync()
  }

  return (
    <button
      onClick={handleSync}
      disabled={syncing || status === "offline"}
      className={cn(
        "flex items-center justify-center h-8 w-8 rounded-full flex-shrink-0 transition-colors",
        status === "offline"
          ? "text-red-400/70 cursor-not-allowed"
          : syncing
            ? "text-orange-400 cursor-wait"
            : "text-emerald-400 hover:text-emerald-300 cursor-pointer",
        className
      )}
      title={syncing ? "Syncing..." : status === "offline" ? "Offline" : "Tap to sync"}
    >
      {syncing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : status === "offline" ? (
        <CloudOff className="h-4 w-4" />
      ) : (
        <Cloud className="h-4 w-4" />
      )}
    </button>
  )
}

// ─── Shared pill bar content ─────────────────────────────────

/**
 * Shared pill bar row — used in both desktop and mobile collapsed states.
 *
 * Layout: [PanelLeft] | [divider] | [equally spaced tabs] | [SyncIcon]
 *
 * Desktop: tabs render as text labels
 * Mobile: tabs render as icon + tiny label
 */
function PillBarContent({
  tabs,
  pathname,
  mode,
  onToggleSidebar,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  mode: "desktop" | "mobile"
  onToggleSidebar: () => void
}) {
  return (
    <div className="flex items-center h-14 px-2">
      {/* Sidebar toggle — fixed width bookend */}
      <button
        onClick={onToggleSidebar}
        className="flex items-center justify-center h-10 w-10 rounded-full text-foreground/70 active:text-foreground flex-shrink-0"
      >
        <PanelLeft className="h-5 w-5" />
      </button>

      {/* Tabs — equally spaced, fill remaining space */}
      <div className="flex items-center flex-1 min-w-0 justify-evenly">
        {tabs.map((tabKey) => {
          const tab = TAB_CONFIG[tabKey]
          if (!tab) return null
          const active = tab.isActive(pathname)
          const Icon = tab.icon

          return (
            <Link key={tabKey} href={tab.href}>
              {mode === "desktop" ? (
                <span
                  className={cn(
                    "inline-flex items-center justify-center h-9 px-4 rounded-full text-sm font-medium transition-colors",
                    active
                      ? "bg-foreground/10 text-primary"
                      : "text-foreground/60 active:text-foreground"
                  )}
                >
                  {tab.label}
                </span>
              ) : (
                <span
                  className={cn(
                    "inline-flex flex-col items-center justify-center gap-0.5 h-11 px-3 rounded-full transition-colors",
                    active
                      ? "bg-foreground/10 text-primary"
                      : "text-foreground/60 active:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[9px] leading-none">{tab.label}</span>
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Sync status — fixed width bookend */}
      <SyncIconButton />
    </div>
  )
}

// ─── Shared sidebar nav content ──────────────────────────────

function SidebarNav({
  pathname,
  className,
}: {
  pathname: string
  className?: string
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleSection = (label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  return (
    <nav
      className={cn("overflow-y-auto overscroll-contain px-3 pb-4", className)}
      style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
    >
      <SidebarNavItem
        href={dashboardNavItem.href}
        icon={dashboardNavItem.icon}
        label={dashboardNavItem.label}
        isActive={isItemActive("/")}
      />
      {navSections.map((section) => {
        const isCollapsed = collapsed[section.label]
        return (
          <div key={section.label} className="mt-3">
            <button
              onClick={() => toggleSection(section.label)}
              className="flex items-center justify-between w-full px-3 mb-1 group cursor-pointer"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.label}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground/40 transition-transform duration-200",
                  isCollapsed && "-rotate-90"
                )}
              />
            </button>
            {!isCollapsed &&
              section.items.map((item) => (
                <SidebarNavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={isItemActive(item.href)}
                />
              ))}
          </div>
        )
      })}
    </nav>
  )
}

function SidebarNavItem({
  href,
  icon,
  label,
  isActive,
}: {
  href: string
  icon: React.ReactNode
  label: string
  isActive: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150",
        "active:scale-[0.98] active:bg-foreground/8",
        isActive
          ? "bg-foreground/10 text-primary font-medium"
          : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
      )}
    >
      <span className={cn("flex-shrink-0", isActive ? "text-primary" : "text-foreground/50")}>
        {icon}
      </span>
      {label}
    </Link>
  )
}

// ─── Viewport measurement hook ───────────────────────────────

function useViewportMeasure() {
  const [vh, setVh] = useState(typeof window !== "undefined" ? window.innerHeight : 800)
  const [safeAreaTop, setSafeAreaTop] = useState(0)
  const [bannerHeight, setBannerHeight] = useState(0)

  useEffect(() => {
    const measure = () => {
      setVh(window.innerHeight)
      const el = document.createElement("div")
      el.style.position = "fixed"
      el.style.top = "env(safe-area-inset-top, 0px)"
      el.style.visibility = "hidden"
      document.body.appendChild(el)
      const top = el.getBoundingClientRect().top
      document.body.removeChild(el)
      setSafeAreaTop(top)
      const bh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--install-banner-height") || "0")
      setBannerHeight(bh || 0)
    }
    measure()
    window.addEventListener("resize", measure)
    const obs = new MutationObserver(measure)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] })
    return () => { window.removeEventListener("resize", measure); obs.disconnect() }
  }, [])

  const expandedHeight = vh - SIDEBAR_MARGIN * 2 - safeAreaTop - bannerHeight
  return { expandedHeight, safeAreaTop, bannerHeight }
}

// ─── Main export ─────────────────────────────────────────────

export function NavPill() {
  const isDesktop = useIsDesktop()
  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebar()
  const { hideNavbar } = useScrollNavbarContext()
  const pathname = usePathname()
  const { preferences } = usePreferences()
  const prefersReducedMotion = useReducedMotion()

  const tabs = preferences.navigation.bottomNavTabs

  return isDesktop ? (
    <DesktopPillMorph
      tabs={tabs}
      pathname={pathname}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={toggleSidebar}
      prefersReducedMotion={!!prefersReducedMotion}
    />
  ) : (
    <MobilePillMorph
      tabs={tabs}
      pathname={pathname}
      hideNavbar={hideNavbar}
      prefersReducedMotion={!!prefersReducedMotion}
    />
  )
}

// ─── Morph phase state machine (shared) ──────────────────────

type MorphPhase = "pill" | "sliding" | "expanding" | "sidebar" | "collapsing" | "returning"

function useMorphPhase(isOpen: boolean, phaseDuration: number) {
  const [phase, setPhase] = useState<MorphPhase>(isOpen ? "sidebar" : "pill")
  const prevOpenRef = useRef(isOpen)
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (prevOpenRef.current === isOpen) return
    prevOpenRef.current = isOpen
    setPhase(isOpen ? "sliding" : "collapsing")
  }, [isOpen])

  const advancePhase = useCallback(() => {
    clearTimeout(safetyTimerRef.current)
    setPhase((current) => {
      switch (current) {
        case "sliding": return "expanding"
        case "expanding": return "sidebar"
        case "collapsing": return "returning"
        case "returning": return "pill"
        default: return current
      }
    })
  }, [])

  useEffect(() => {
    const isTransitioning = phase === "sliding" || phase === "expanding" || phase === "collapsing" || phase === "returning"
    if (!isTransitioning) return
    clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(advancePhase, phaseDuration + 50)
    return () => clearTimeout(safetyTimerRef.current)
  }, [phase, phaseDuration, advancePhase])

  const isAtSidebarPosition = phase === "sliding" || phase === "expanding" || phase === "sidebar" || phase === "collapsing"
  const isAtFullHeight = phase === "expanding" || phase === "sidebar"
  const isExpanded = phase === "sidebar" || phase === "expanding"

  return { phase, advancePhase, isAtSidebarPosition, isAtFullHeight, isExpanded }
}

// ─── Desktop: top pill ↔ sidebar ─────────────────────────────

function DesktopPillMorph({
  tabs,
  pathname,
  sidebarOpen,
  onToggleSidebar,
  prefersReducedMotion,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  sidebarOpen: boolean
  onToggleSidebar: () => void
  prefersReducedMotion: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { expandedHeight } = useViewportMeasure()
  const PHASE_DURATION = prefersReducedMotion ? 0 : 100

  const { phase, advancePhase, isAtSidebarPosition, isAtFullHeight, isExpanded } =
    useMorphPhase(sidebarOpen, PHASE_DURATION)

  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.target !== ref.current) return
    advancePhase()
  }, [advancePhase])

  const transitionProperty = (() => {
    switch (phase) {
      case "sliding": return "top, left, transform, width"
      case "expanding": return "height"
      case "collapsing": return "height"
      case "returning": return "top, left, transform, width"
      default: return "none"
    }
  })()

  const style: React.CSSProperties = {
    top: isAtSidebarPosition
      ? `calc(${SIDEBAR_MARGIN}px + env(safe-area-inset-top, 0px) + var(--install-banner-height, 0px))`
      : `calc(${PILL_TOP}px + env(safe-area-inset-top, 0px) + var(--install-banner-height, 0px))`,
    left: isAtSidebarPosition ? SIDEBAR_MARGIN : "50%",
    transform: isAtSidebarPosition ? "translateX(0)" : "translateX(-50%)",
    width: isAtSidebarPosition ? SIDEBAR_INNER_WIDTH : "auto",
    height: isAtFullHeight ? expandedHeight : PILL_HEIGHT,
    transitionProperty,
    transitionDuration: `${PHASE_DURATION}ms`,
    transitionTimingFunction: "cubic-bezier(0.25, 0.1, 0.25, 1)",
  }

  return (
    <div
      ref={ref}
      className="fixed z-[100]"
      style={style}
      onTransitionEnd={handleTransitionEnd}
    >
      <GlassContainer
        cornerRadius={isExpanded ? 20 : 28}
        className="h-full"
        contentClassName="h-full !overflow-hidden !flex !flex-col"
      >
        {/* Pill bar — always visible */}
        <div
          className="flex-shrink-0"
          style={{
            opacity: isExpanded ? 0 : 1,
            visibility: isExpanded ? "hidden" : "visible",
            pointerEvents: isExpanded ? "none" : "auto",
            height: isExpanded ? 0 : PILL_HEIGHT,
            transition: "opacity 0.1s",
          }}
        >
          <PillBarContent
            tabs={tabs}
            pathname={pathname}
            mode="desktop"
            onToggleSidebar={onToggleSidebar}
          />
        </div>

        {/* Sidebar header + nav — visible when expanded */}
        <div
          className="flex flex-col flex-1 min-h-0 transition-opacity duration-150"
          style={{
            opacity: isExpanded ? 1 : 0,
            visibility: isExpanded ? "visible" : "hidden",
            pointerEvents: isExpanded ? "auto" : "none",
          }}
        >
          {/* Sidebar top row — toggle + sync flushed right */}
          <div className="flex items-center justify-end h-14 px-3 gap-1 flex-shrink-0">
            <button
              onClick={onToggleSidebar}
              className="flex items-center justify-center h-10 w-10 rounded-full text-foreground/70 active:text-foreground flex-shrink-0"
            >
              <PanelLeft className="h-5 w-5" />
            </button>
            <SyncIconButton />
          </div>

          <SidebarNav pathname={pathname} className="flex-1 min-h-0" />
        </div>
      </GlassContainer>
    </div>
  )
}

// ─── Mobile: bottom pill ↔ sidebar ───────────────────────────

function MobilePillMorph({
  tabs,
  pathname,
  hideNavbar,
  prefersReducedMotion,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  hideNavbar: boolean
  prefersReducedMotion: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { expandedHeight } = useViewportMeasure()
  const PHASE_DURATION = prefersReducedMotion ? 0 : 150

  const { phase, advancePhase, isAtSidebarPosition, isAtFullHeight, isExpanded } =
    useMorphPhase(sidebarOpen, PHASE_DURATION)

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.target !== ref.current) return
    advancePhase()
  }, [advancePhase])

  // Mobile morph — always bottom-anchored:
  // pill: bottom-center, auto width, pill height
  // sliding: slides to bottom-left, widens to sidebar width (still pill height)
  // expanding: grows UPWARD (bottom anchored, height increases)
  // sidebar: full sidebar height, bottom-left

  const transitionProperty = (() => {
    switch (phase) {
      case "sliding": return "left, transform, width"
      case "expanding": return "height"
      case "collapsing": return "height"
      case "returning": return "left, transform, width"
      default: return "none"
    }
  })()

  const style: React.CSSProperties = {
    position: "fixed" as const,
    bottom: `calc(${SIDEBAR_MARGIN}px + env(safe-area-inset-bottom, 0px))`,
    left: isAtSidebarPosition ? SIDEBAR_MARGIN : "50%",
    transform: isAtSidebarPosition
      ? "translateX(0)"
      : `translateX(-50%) translateY(${hideNavbar ? "calc(100% + 24px)" : "0%"})`,
    width: isAtSidebarPosition ? SIDEBAR_INNER_WIDTH : "auto",
    height: isAtFullHeight ? expandedHeight : PILL_HEIGHT,
    transitionProperty: phase === "pill"
      ? "transform"
      : transitionProperty,
    transitionDuration: phase === "pill"
      ? (prefersReducedMotion ? "0ms" : "300ms")
      : `${PHASE_DURATION}ms`,
    transitionTimingFunction: phase === "pill"
      ? "cubic-bezier(0.34, 1.56, 0.64, 1)"
      : "cubic-bezier(0.25, 0.1, 0.25, 1)",
  }

  return (
    <>
      {/* Backdrop — visible when sidebar is open */}
      <div
        className="fixed inset-0 z-[59] bg-black/40 transition-opacity duration-200"
        style={{
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
        onClick={() => setSidebarOpen(false)}
      />

      <div
        ref={ref}
        className="z-[100]"
        style={style}
        onTransitionEnd={handleTransitionEnd}
      >
        <GlassContainer
          cornerRadius={isExpanded ? 20 : 28}
          className="h-full"
          contentClassName="h-full !overflow-hidden !flex !flex-col"
        >
          {/* Pill bar — visible when collapsed */}
          <div
            className="flex-shrink-0"
            style={{
              opacity: isExpanded ? 0 : 1,
              visibility: isExpanded ? "hidden" : "visible",
              pointerEvents: isExpanded ? "none" : "auto",
              height: isExpanded ? 0 : PILL_HEIGHT,
              transition: "opacity 0.1s",
            }}
          >
            <PillBarContent
              tabs={tabs}
              pathname={pathname}
              mode="mobile"
              onToggleSidebar={() => setSidebarOpen(true)}
            />
          </div>

          {/* Sidebar header + nav — visible when expanded */}
          <div
            className="flex flex-col flex-1 min-h-0 transition-opacity duration-150"
            style={{
              opacity: isExpanded ? 1 : 0,
              visibility: isExpanded ? "visible" : "hidden",
              pointerEvents: isExpanded ? "auto" : "none",
            }}
          >
            {/* Sidebar top row — toggle + sync flushed right */}
            <div className="flex items-center justify-end h-14 px-3 gap-1 flex-shrink-0">
              <button
                onClick={() => setSidebarOpen(false)}
                className="flex items-center justify-center h-10 w-10 rounded-full text-foreground/70 active:text-foreground flex-shrink-0"
              >
                <PanelLeft className="h-5 w-5" />
              </button>
              <SyncIconButton />
            </div>

            <SidebarNav pathname={pathname} className="flex-1 min-h-0" />
          </div>
        </GlassContainer>
      </div>
    </>
  )
}
