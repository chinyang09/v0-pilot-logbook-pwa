"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
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
import { Button } from "@/components/ui/button"
import { GlassContainer } from "@/components/ui/glass-container"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { usePreferences } from "@/components/providers/preferences-provider"
import { navSections, dashboardNavItem } from "@/components/nav-sections"
import { useSyncStatus, useSyncTrigger } from "@/hooks/sync/use-sync-status"
import type { BottomNavTab } from "@/types/db/stores.types"

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

const springTransition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
}

const instantTransition = {
  duration: 0,
}

/**
 * Unified floating nav component.
 *
 * - Mobile (<768px): Bottom floating pill (auto-width, centered) with sidebar toggle + 4 icon tabs
 * - Desktop (≥768px): Top floating pill with sidebar toggle + text tabs
 *
 * Both morph into an identical floating glass sidebar on the left.
 */
export function NavPill() {
  const isDesktop = useIsDesktop()
  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebar()
  const { hideNavbar } = useScrollNavbarContext()
  const pathname = usePathname()
  const { preferences } = usePreferences()
  const prefersReducedMotion = useReducedMotion()

  const tabs = preferences.navigation.bottomNavTabs
  const transition = prefersReducedMotion ? instantTransition : springTransition

  return isDesktop ? (
    <DesktopPillMorph
      tabs={tabs}
      pathname={pathname}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={toggleSidebar}
      prefersReducedMotion={!!prefersReducedMotion}
    />
  ) : (
    <MobilePill
      tabs={tabs}
      pathname={pathname}
      hideNavbar={hideNavbar}
      transition={transition}
    />
  )
}

// ─── Sync status icon button ─────────────────────────────────

function SyncIconButton() {
  const { status, isSyncing: statusSyncing } = useSyncStatus()
  const { triggerSync, isSyncing: triggerSyncing } = useSyncTrigger()
  const syncing = statusSyncing || triggerSyncing

  const handleSync = () => {
    if (!syncing && status !== "offline") triggerSync()
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleSync}
      disabled={syncing || status === "offline"}
      className={cn(
        "h-11 w-11 flex-shrink-0",
        status === "offline"
          ? "text-muted-foreground/40"
          : "text-foreground/70 hover:text-foreground"
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
    </Button>
  )
}

// ─── Shared sidebar nav content ──────────────────────────────

/** Shared sidebar nav list — used by both desktop and mobile sidebars */
function SidebarNav({
  pathname,
  className,
}: {
  pathname: string
  className?: string
}) {
  // Track collapsed sections. All expanded by default.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleSection = (label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  return (
    <nav className={cn("overflow-y-auto overscroll-contain px-3 pb-4", className)}>
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

/** Single sidebar nav item */
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
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
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

// ─── Desktop: morphing pill ↔ sidebar ───────────────────────

const SIDEBAR_WIDTH = 288
const SIDEBAR_PADDING = 12
const SIDEBAR_INNER_WIDTH = SIDEBAR_WIDTH - SIDEBAR_PADDING * 2 // 264
const PILL_HEIGHT = 56 // h-14
const COLLAPSED_TOP = 4 // vertically center pill (56px) within header bar (64px)

type MorphPhase = "pill" | "sliding" | "expanding" | "sidebar" | "collapsing" | "returning"

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
  const [phase, setPhase] = useState<MorphPhase>(sidebarOpen ? "sidebar" : "pill")
  const prevOpenRef = useRef(sidebarOpen)
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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

  const expandedHeight = vh - SIDEBAR_PADDING * 2 - safeAreaTop - bannerHeight
  const PHASE_DURATION = prefersReducedMotion ? 0 : 100

  useEffect(() => {
    if (prevOpenRef.current === sidebarOpen) return
    prevOpenRef.current = sidebarOpen
    setPhase(sidebarOpen ? "sliding" : "collapsing")
  }, [sidebarOpen])

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

  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.target !== ref.current) return
    advancePhase()
  }, [advancePhase])

  useEffect(() => {
    const isTransitioning = phase === "sliding" || phase === "expanding" || phase === "collapsing" || phase === "returning"
    if (!isTransitioning) return
    clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(advancePhase, PHASE_DURATION + 50)
    return () => clearTimeout(safetyTimerRef.current)
  }, [phase, PHASE_DURATION, advancePhase])

  const isAtSidebarPosition = phase === "sliding" || phase === "expanding" || phase === "sidebar" || phase === "collapsing"
  const isAtFullHeight = phase === "expanding" || phase === "sidebar"
  const isExpanded = phase === "sidebar" || phase === "expanding"

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
      ? `calc(${SIDEBAR_PADDING}px + env(safe-area-inset-top, 0px) + var(--install-banner-height, 0px))`
      : `calc(${COLLAPSED_TOP}px + env(safe-area-inset-top, 0px) + var(--install-banner-height, 0px))`,
    left: isAtSidebarPosition ? SIDEBAR_PADDING : "50%",
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
        contentClassName="h-full overflow-hidden flex flex-col"
      >
        {/* Top row — toggle + sync icon (always visible), pill tabs when collapsed */}
        <div className="flex items-center h-14 px-3 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="h-11 w-11 text-foreground/70 hover:text-foreground flex-shrink-0"
          >
            <PanelLeft className="h-5 w-5" />
          </Button>

          {/* Pill nav tabs — text labels, hidden when expanded */}
          <div
            className="flex items-center gap-0.5 flex-1 min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-100"
            style={{
              opacity: isExpanded ? 0 : 1,
              visibility: isExpanded ? "hidden" : "visible",
              pointerEvents: isExpanded ? "none" : "auto",
            }}
          >
            <div className="w-px h-7 bg-border/50 mx-1" />
            {tabs.map((tabKey) => {
              const tab = TAB_CONFIG[tabKey]
              if (!tab) return null
              const active = tab.isActive(pathname)
              return (
                <Link key={tabKey} href={tab.href}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-10 px-3 text-sm font-medium",
                      active ? "text-primary" : "text-foreground/60 hover:text-foreground"
                    )}
                  >
                    {tab.label}
                  </Button>
                </Link>
              )
            })}
          </div>

          <SyncIconButton />
        </div>

        {/* Sidebar nav — scrollable, revealed when expanded */}
        <div
          className="flex-1 min-h-0 transition-opacity duration-150"
          style={{
            opacity: isExpanded ? 1 : 0,
            visibility: isExpanded ? "visible" : "hidden",
            pointerEvents: isExpanded ? "auto" : "none",
          }}
        >
          <SidebarNav pathname={pathname} className="h-full" />
        </div>
      </GlassContainer>
    </div>
  )
}

// ─── Mobile: bottom floating pill + glass sidebar ────────────

function MobilePill({
  tabs,
  pathname,
  hideNavbar,
  transition,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  hideNavbar: boolean
  transition: typeof springTransition | typeof instantTransition
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const leftTabs = tabs.slice(0, 2)
  const rightTabs = tabs.slice(2, 4)

  // Viewport measurements for sidebar height (same as desktop)
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

  const sidebarHeight = vh - SIDEBAR_PADDING * 2 - safeAreaTop - bannerHeight

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

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

      {/* Floating glass sidebar — identical to desktop expanded sidebar */}
      <div
        className="fixed z-[100]"
        style={{
          top: `calc(${SIDEBAR_PADDING}px + env(safe-area-inset-top, 0px) + var(--install-banner-height, 0px))`,
          left: SIDEBAR_PADDING,
          width: SIDEBAR_INNER_WIDTH,
          height: sidebarHeight,
          transform: sidebarOpen ? "translateX(0)" : "translateX(calc(-100% - 24px))",
          opacity: sidebarOpen ? 1 : 0,
          transition: "transform 0.2s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.2s ease",
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
      >
        <GlassContainer
          cornerRadius={20}
          className="h-full"
          contentClassName="h-full overflow-hidden flex flex-col"
        >
          {/* Top row — toggle + sync */}
          <div className="flex items-center h-14 px-3 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(false)}
              className="h-11 w-11 text-foreground/70 hover:text-foreground flex-shrink-0"
            >
              <PanelLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1" />
            <SyncIconButton />
          </div>

          {/* Scrollable nav */}
          <SidebarNav pathname={pathname} className="flex-1 min-h-0" />
        </GlassContainer>
      </div>

      {/* Bottom pill — auto-width, centered */}
      <motion.div
        className="fixed z-[60] bottom-0 left-0 right-0 flex justify-center px-4 pb-[env(safe-area-inset-bottom,0px)] mb-2"
        animate={{ y: hideNavbar ? "100%" : "0%" }}
        transition={transition}
      >
        <GlassContainer cornerRadius={28}>
          <nav className="flex items-center h-16 px-1">
            {/* Sidebar toggle — left side */}
            <Button
              variant="ghost"
              className="h-12 w-12 text-foreground/70 hover:text-foreground flex-shrink-0"
              size="icon"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="h-5 w-5" />
            </Button>

            <div className="w-px h-7 bg-border/50 mx-0.5 flex-shrink-0" />

            {/* Tab icons */}
            {leftTabs.map((tabKey) => {
              const tab = TAB_CONFIG[tabKey]
              if (!tab) return null
              const Icon = tab.icon
              return (
                <Link key={tabKey} href={tab.href} className="flex-1">
                  <Button
                    variant="ghost"
                    className={cn(
                      "flex flex-col items-center gap-0.5 h-14 w-full px-3",
                      tab.isActive(pathname) && "text-primary"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-[9px]">{tab.label}</span>
                  </Button>
                </Link>
              )
            })}

            {rightTabs.map((tabKey) => {
              const tab = TAB_CONFIG[tabKey]
              if (!tab) return null
              const Icon = tab.icon
              return (
                <Link key={tabKey} href={tab.href} className="flex-1">
                  <Button
                    variant="ghost"
                    className={cn(
                      "flex flex-col items-center gap-0.5 h-14 w-full px-3",
                      tab.isActive(pathname) && "text-primary"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-[9px]">{tab.label}</span>
                  </Button>
                </Link>
              )
            })}
          </nav>
        </GlassContainer>
      </motion.div>
    </>
  )
}
