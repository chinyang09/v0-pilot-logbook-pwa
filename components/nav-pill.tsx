"use client"

import type React from "react"
import { useState, useEffect } from "react"
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
const COLLAPSED_TOP = 8 // 0.5rem

/**
 * Desktop pill that morphs into a full-height sidebar via spring animation.
 *
 * Open sequence:
 *   1. Pill slides left + grows wider to sidebar width
 *   2. Panels push right (handled by PushSidebar spacer)
 *   3. Pill expands height top-down → becomes sidebar
 *
 * Close is the reverse.
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
    : { type: "spring" as const, stiffness: 400, damping: 30 }

  const heightSpring = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 350, damping: 28 }

  return (
    <motion.div
      className="fixed z-[100]"
      initial={false}
      animate={{
        top: sidebarOpen ? SIDEBAR_PADDING : COLLAPSED_TOP,
        left: sidebarOpen ? SIDEBAR_PADDING : "50%",
        x: sidebarOpen ? 0 : "-50%",
        width: sidebarOpen ? SIDEBAR_INNER_WIDTH : "auto",
        height: sidebarOpen ? expandedHeight : PILL_HEIGHT,
      }}
      transition={{
        ...spring,
        // Height expands AFTER horizontal slide (open), or shrinks FIRST (close)
        height: {
          ...heightSpring,
          delay: sidebarOpen ? 0.06 : 0,
        },
        // Horizontal movement: immediate on open, slightly delayed on close
        left: { ...spring, delay: sidebarOpen ? 0 : 0.04 },
        x: { ...spring, delay: sidebarOpen ? 0 : 0.04 },
        width: { ...spring, delay: sidebarOpen ? 0 : 0.04 },
      }}
    >
      <GlassContainer
        cornerRadius={sidebarOpen ? 20 : 28}
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

            {/* Pill nav tabs — text labels, fade out when sidebar opens */}
            <motion.div
              className="flex items-center gap-0.5 overflow-hidden whitespace-nowrap"
              animate={{
                opacity: sidebarOpen ? 0 : 1,
                visibility: sidebarOpen ? "hidden" as const : "visible" as const,
              }}
              transition={{
                opacity: { duration: 0.1 },
                visibility: { delay: sidebarOpen ? 0.1 : 0 },
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
            </motion.div>
          </div>

          {/* Sidebar nav list — revealed as height expands top-down */}
          <motion.nav
            className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5"
            animate={{
              opacity: sidebarOpen ? 1 : 0,
              visibility: sidebarOpen ? "visible" as const : "hidden" as const,
            }}
            transition={{
              opacity: { duration: 0.15, delay: sidebarOpen ? 0.12 : 0 },
              visibility: { delay: sidebarOpen ? 0 : 0.15 },
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
          </motion.nav>
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
