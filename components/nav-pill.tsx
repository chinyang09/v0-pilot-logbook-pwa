"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import {
  LayoutDashboard,
  Book,
  Plus,
  Calendar,
  Plane,
  Users,
  MapPin,
  Award,
  Settings,
  UserCircle,
  PanelLeft,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { GlassContainer } from "@/components/ui/glass-container"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useCreateFlight } from "@/hooks/use-create-flight"
import { usePreferences } from "@/components/providers/preferences-provider"
import { navSections, dashboardNavItem } from "@/components/nav-sections"
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
 * - Mobile (<768px): Bottom floating pill with 4 nav icons + center FAB
 * - Desktop (≥768px): Top floating pill that morphs into a full sidebar
 */
export function NavPill() {
  const isDesktop = useIsDesktop()
  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebar()
  const { hideNavbar } = useScrollNavbarContext()
  const pathname = usePathname()
  const router = useRouter()
  const createFlight = useCreateFlight()
  const { preferences } = usePreferences()
  const prefersReducedMotion = useReducedMotion()

  const tabs = preferences.navigation.bottomNavTabs
  const transition = prefersReducedMotion ? instantTransition : springTransition

  const handleCreateFlight = async () => {
    const draft = await createFlight()
    router.push(`/logbook?selected=${draft.id}`)
  }

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
      onCreateFlight={handleCreateFlight}
      transition={transition}
    />
  )
}

// ─── Desktop: morphing pill ↔ sidebar ───────────────────────

const SIDEBAR_WIDTH = 288
const SIDEBAR_PADDING = 12
const SIDEBAR_INNER_WIDTH = SIDEBAR_WIDTH - SIDEBAR_PADDING * 2 // 264
const PILL_HEIGHT = 56 // h-14
const COLLAPSED_TOP = 4 // vertically center pill (56px) within header bar (64px)

/**
 * Desktop pill that morphs into a full-height sidebar via CSS transitions.
 *
 * Uses a two-phase state machine with CSS transitions (0.1s each phase = 0.2s total).
 * Phase states: "pill" | "sliding" | "expanding" | "sidebar" | "collapsing" | "returning"
 *
 * Open: pill → sliding (left+widen, 0.1s) → expanding (height, 0.1s) → sidebar
 * Close: sidebar → collapsing (height, 0.1s) → returning (right+shrink, 0.1s) → pill
 */
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
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Viewport height, safe area, and install banner for expanded sidebar
  const [vh, setVh] = useState(typeof window !== "undefined" ? window.innerHeight : 800)
  const [safeAreaTop, setSafeAreaTop] = useState(0)
  const [bannerHeight, setBannerHeight] = useState(0)
  useEffect(() => {
    const measure = () => {
      setVh(window.innerHeight)
      // Measure safe-area-inset-top via a temporary element
      const el = document.createElement("div")
      el.style.position = "fixed"
      el.style.top = "env(safe-area-inset-top, 0px)"
      el.style.visibility = "hidden"
      document.body.appendChild(el)
      const top = el.getBoundingClientRect().top
      document.body.removeChild(el)
      setSafeAreaTop(top)
      // Read install banner height from CSS variable
      const bh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--install-banner-height") || "0")
      setBannerHeight(bh || 0)
    }
    measure()
    window.addEventListener("resize", measure)
    // Re-measure when banner CSS var changes (via MutationObserver on style attr)
    const obs = new MutationObserver(measure)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] })
    return () => { window.removeEventListener("resize", measure); obs.disconnect() }
  }, [])

  const expandedHeight = vh - SIDEBAR_PADDING * 2 - safeAreaTop - bannerHeight
  const PHASE_DURATION = prefersReducedMotion ? 0 : 100 // ms per phase

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  // Drive the two-phase state machine
  useEffect(() => {
    if (prevOpenRef.current === sidebarOpen) return
    prevOpenRef.current = sidebarOpen

    if (sidebarOpen) {
      // Start open sequence: pill → sliding
      setPhase("sliding")
    } else {
      // Start close sequence: sidebar → collapsing
      setPhase("collapsing")
    }
  }, [sidebarOpen])

  // Advance to next phase in the state machine
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

  // Handle transitionend events (only advance on the last property to finish)
  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    // Only respond to transitions on this element, not children
    if (e.target !== ref.current) return
    advancePhase()
  }, [advancePhase])

  // Safety timeout: if transitionend doesn't fire (e.g. width:auto, no actual change),
  // advance after PHASE_DURATION + 50ms buffer
  useEffect(() => {
    const isTransitioning = phase === "sliding" || phase === "expanding" || phase === "collapsing" || phase === "returning"
    if (!isTransitioning) return

    clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(advancePhase, PHASE_DURATION + 50)
    return () => clearTimeout(safetyTimerRef.current)
  }, [phase, PHASE_DURATION, advancePhase])

  // Compute styles based on current phase
  const isAtSidebarPosition = phase === "sliding" || phase === "expanding" || phase === "sidebar" || phase === "collapsing"
  const isAtFullHeight = phase === "expanding" || phase === "sidebar"
  const isExpanded = phase === "sidebar" || phase === "expanding"

  // Which properties are transitioning in this phase
  const transitionProperty = (() => {
    switch (phase) {
      case "sliding": return "top, left, transform, width"
      case "expanding": return "height"
      case "collapsing": return "height"
      case "returning": return "top, left, transform, width"
      default: return "none"
    }
  })()

  // --install-banner-height is set by PWAInstallPrompt when visible
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
        contentClassName="h-full overflow-hidden"
      >
        <div className="flex flex-col h-full">
          {/* Top row — sidebar toggle + pill nav items (when collapsed) */}
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
              className="flex items-center gap-0.5 overflow-hidden whitespace-nowrap transition-opacity duration-100"
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
          </div>

          {/* Sidebar nav list — revealed when expanded */}
          <nav
            className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5 transition-opacity duration-150"
            style={{
              opacity: isExpanded ? 1 : 0,
              visibility: isExpanded ? "visible" : "hidden",
              pointerEvents: isExpanded ? "auto" : "none",
            }}
          >
            <SidebarNavItem
              href={dashboardNavItem.href}
              icon={dashboardNavItem.icon}
              label={dashboardNavItem.label}
              isActive={isItemActive("/")}
            />
            {navSections.flatMap((section) =>
              section.items.map((item) => (
                <SidebarNavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={isItemActive(item.href)}
                />
              ))
            )}
          </nav>
        </div>
      </GlassContainer>
    </div>
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

// ─── Mobile: bottom floating pill ────────────────────────────

function MobilePill({
  tabs,
  pathname,
  hideNavbar,
  onCreateFlight,
  transition,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  hideNavbar: boolean
  onCreateFlight: () => void
  transition: typeof springTransition | typeof instantTransition
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const leftTabs = tabs.slice(0, 2)
  const rightTabs = tabs.slice(2, 4)

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  return (
    <>
      {/* Overlay sidebar */}
      <div
        className="fixed inset-0 z-[59] transition-opacity duration-200"
        style={{
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
        {/* Sidebar panel */}
        <div
          className="absolute left-0 top-0 bottom-0 w-72 bg-background pt-safe transition-transform duration-200 ease-out overflow-y-auto overscroll-contain"
          style={{
            transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          }}
        >
          <div className="px-4 pt-4 pb-2">
            <Button
              className="w-full h-12 gap-2"
              onClick={() => {
                setSidebarOpen(false)
                onCreateFlight()
              }}
            >
              <Plus className="h-5 w-5" />
              New Flight
            </Button>
          </div>

          <nav className="px-3 pb-4">
            <Link
              href={dashboardNavItem.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                isItemActive("/")
                  ? "bg-foreground/10 text-primary font-medium"
                  : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <span className={cn("flex-shrink-0", isItemActive("/") ? "text-primary" : "text-foreground/50")}>
                {dashboardNavItem.icon}
              </span>
              {dashboardNavItem.label}
            </Link>

            {navSections.map((section) => (
              <div key={section.label} className="mt-4">
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {section.label}
                </p>
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                      isItemActive(item.href)
                        ? "bg-foreground/10 text-primary font-medium"
                        : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
                    )}
                  >
                    <span className={cn("flex-shrink-0", isItemActive(item.href) ? "text-primary" : "text-foreground/50")}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>
      </div>

      {/* Bottom pill */}
      <motion.div
        className="fixed z-[60] bottom-0 left-0 right-0 px-4 pb-[env(safe-area-inset-bottom,0px)] mb-2"
        animate={{ y: hideNavbar ? "100%" : "0%" }}
        transition={transition}
      >
        <GlassContainer cornerRadius={28}>
          <nav className="flex items-center justify-around h-16 px-1">
            {leftTabs.map((tabKey) => {
              const tab = TAB_CONFIG[tabKey]
              if (!tab) return null
              const Icon = tab.icon
              return (
                <Link key={tabKey} href={tab.href} className="flex-1">
                  <Button
                    variant="ghost"
                    className={cn(
                      "flex flex-col items-center gap-0.5 h-14 w-full px-2",
                      tab.isActive(pathname) && "text-primary"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-[9px]">{tab.label}</span>
                  </Button>
                </Link>
              )
            })}

            {/* Center — sidebar toggle */}
            <Button
              variant="ghost"
              className="h-12 w-12 text-foreground/70 hover:text-foreground"
              size="icon"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="h-5 w-5" />
            </Button>

            {rightTabs.map((tabKey) => {
              const tab = TAB_CONFIG[tabKey]
              if (!tab) return null
              const Icon = tab.icon
              return (
                <Link key={tabKey} href={tab.href} className="flex-1">
                  <Button
                    variant="ghost"
                    className={cn(
                      "flex flex-col items-center gap-0.5 h-14 w-full px-2",
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
