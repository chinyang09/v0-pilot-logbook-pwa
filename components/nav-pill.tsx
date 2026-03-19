"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { motion, useAnimate, useReducedMotion } from "framer-motion"
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
const COLLAPSED_TOP = 8 // 0.5rem

/**
 * Desktop pill that morphs into a full-height sidebar via sequential spring animation.
 *
 * Open sequence:
 *   1. Pill slides left + grows wider to sidebar width (waits until complete)
 *   2. Pill expands height top-down → becomes sidebar
 *
 * Close sequence:
 *   1. Sidebar collapses height to pill height (waits until complete)
 *   2. Pill slides right back to center
 */
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
  const [scope, animate] = useAnimate()
  const isAnimatingRef = useRef(false)
  const prevOpenRef = useRef(sidebarOpen)
  const initializedRef = useRef(false)

  // Track internal visual state for content visibility (pill tabs vs sidebar nav)
  const [isExpanded, setIsExpanded] = useState(sidebarOpen)

  // Viewport height for expanded sidebar height calculation
  const [vh, setVh] = useState(800)
  useEffect(() => {
    setVh(window.innerHeight)
    const onResize = () => setVh(window.innerHeight)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const expandedHeight = vh - SIDEBAR_PADDING * 2

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  const spring = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 500, damping: 32 }

  const heightSpring = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 450, damping: 30 }

  // Run sequential animation when sidebarOpen changes
  const runAnimation = useCallback(async (opening: boolean) => {
    if (!scope.current || isAnimatingRef.current) return
    isAnimatingRef.current = true

    try {
      if (opening) {
        // Step 1: Slide left + widen (pill → sidebar position)
        await animate(scope.current, {
          top: SIDEBAR_PADDING,
          left: SIDEBAR_PADDING,
          x: 0,
          width: SIDEBAR_INNER_WIDTH,
        }, spring)

        // Step 2: Expand height (pill → full sidebar)
        setIsExpanded(true)
        await animate(scope.current, {
          height: expandedHeight,
        }, heightSpring)
      } else {
        // Step 1: Collapse height (sidebar → pill height)
        setIsExpanded(false)
        await animate(scope.current, {
          height: PILL_HEIGHT,
        }, heightSpring)

        // Step 2: Slide right back to center
        await animate(scope.current, {
          top: COLLAPSED_TOP,
          left: "50%",
          x: "-50%",
          width: "auto",
        }, spring)
      }
    } finally {
      isAnimatingRef.current = false
    }
  }, [scope, animate, spring, heightSpring, expandedHeight])

  // Set initial position on mount (no animation)
  useEffect(() => {
    if (!scope.current || initializedRef.current) return
    initializedRef.current = true
    const el = scope.current
    if (sidebarOpen) {
      el.style.top = `${SIDEBAR_PADDING}px`
      el.style.left = `${SIDEBAR_PADDING}px`
      el.style.transform = "translateX(0)"
      el.style.width = `${SIDEBAR_INNER_WIDTH}px`
      el.style.height = `${expandedHeight}px`
    } else {
      el.style.top = `${COLLAPSED_TOP}px`
      el.style.left = "50%"
      el.style.transform = "translateX(-50%)"
      el.style.width = "auto"
      el.style.height = `${PILL_HEIGHT}px`
    }
  }, [scope, sidebarOpen, expandedHeight])

  // Animate on state change (skip first render)
  useEffect(() => {
    if (prevOpenRef.current === sidebarOpen) return
    prevOpenRef.current = sidebarOpen
    runAnimation(sidebarOpen)
  }, [sidebarOpen, runAnimation])

  return (
    <motion.div
      ref={scope}
      className="fixed z-[100]"
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
    </motion.div>
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
  const leftTabs = tabs.slice(0, 2)
  const rightTabs = tabs.slice(2, 4)

  return (
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

          {/* Center FAB — glass with primary tint */}
          <GlassContainer cornerRadius={999} tintColor="var(--primary)" tintOpacity={0.35}>
            <Button
              variant="ghost"
              className="h-12 w-12 text-primary-foreground hover:text-primary-foreground"
              size="icon"
              onClick={onCreateFlight}
            >
              <Plus className="h-6 w-6" />
            </Button>
          </GlassContainer>

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
  )
}
