"use client"

import type React from "react"
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
 * Unified floating nav pill component — pill only, no sidebar.
 *
 * - Mobile (<768px): Bottom floating pill with 4 nav icons + center FAB
 * - Desktop (≥768px): Top floating pill with sidebar toggle + 4 nav icons + FAB
 *
 * The push sidebar is a separate component (PushSidebar) rendered in desktop-layout.tsx.
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
    <DesktopPill
      tabs={tabs}
      pathname={pathname}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={toggleSidebar}
      onCreateFlight={handleCreateFlight}
      transition={transition}
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

/** Desktop: top floating pill with sidebar toggle.
 * Stays mounted — animates opacity/scale/position based on sidebar state (no flash). */
function DesktopPill({
  tabs,
  pathname,
  sidebarOpen,
  onToggleSidebar,
  onCreateFlight,
  transition,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onCreateFlight: () => void
  transition: typeof springTransition | typeof instantTransition
}) {
  return (
    <motion.div
      className="fixed z-[100] top-[calc(env(safe-area-inset-top,0px)+0.5rem)] left-1/2"
      initial={false}
      animate={{
        x: "-50%",
        opacity: sidebarOpen ? 0 : 1,
        scale: sidebarOpen ? 0.9 : 1,
        pointerEvents: sidebarOpen ? "none" : "auto",
      }}
      transition={transition}
    >
      <GlassContainer cornerRadius={28}>
        <nav className="flex items-center gap-1.5 px-3 h-14">
          {/* Sidebar toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="h-11 w-11 text-foreground/70 hover:text-foreground flex-shrink-0"
          >
            <PanelLeft className="h-5 w-5" />
          </Button>

          <div className="w-px h-7 bg-border/50 mx-0.5" />

          {/* Nav tabs */}
          {tabs.map((tabKey) => {
            const tab = TAB_CONFIG[tabKey]
            if (!tab) return null
            const Icon = tab.icon
            const active = tab.isActive(pathname)
            return (
              <Link key={tabKey} href={tab.href}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-11 w-11",
                    active ? "text-primary" : "text-foreground/60 hover:text-foreground"
                  )}
                >
                  <Icon className="h-6 w-6" />
                </Button>
              </Link>
            )
          })}

          <div className="w-px h-7 bg-border/50 mx-0.5" />

          {/* New flight FAB — glass with primary tint */}
          <GlassContainer cornerRadius={999} tintColor="var(--primary)" tintOpacity={0.35}>
            <Button
              variant="ghost"
              className="h-11 w-11 text-primary-foreground hover:text-primary-foreground"
              size="icon"
              onClick={onCreateFlight}
            >
              <Plus className="h-6 w-6" />
            </Button>
          </GlassContainer>
        </nav>
      </GlassContainer>
    </motion.div>
  )
}

/** Mobile: bottom floating pill */
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
