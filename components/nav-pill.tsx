"use client"

import type React from "react"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
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
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { GlassContainer } from "@/components/ui/glass-container"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useCreateFlight } from "@/hooks/use-create-flight"
import { usePreferences } from "@/components/providers/preferences-provider"
import {
  navSections,
  dashboardNavItem,
  NavItemLink,
  NavSectionGroup,
} from "@/components/nav-sections"
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
 * Unified floating nav pill component.
 *
 * - Mobile (<768px): Bottom floating pill with 4 nav icons + center FAB
 * - Desktop (≥768px): Top floating pill with sidebar toggle + 4 nav icons + FAB
 *   Expands into a push sidebar via spring animation
 */
export function NavPill() {
  const isDesktop = useIsDesktop()
  const { isOpen: sidebarOpen, toggle: toggleSidebar, close: closeSidebar } = useSidebar()
  const { hideNavbar } = useScrollNavbarContext()
  const pathname = usePathname()
  const router = useRouter()
  const createFlight = useCreateFlight()
  const { preferences } = usePreferences()
  const prefersReducedMotion = useReducedMotion()

  const tabs = preferences.navigation.bottomNavTabs
  const transition = prefersReducedMotion ? instantTransition : springTransition

  // On desktop, when sidebar is expanded, render the full sidebar instead of the pill
  if (isDesktop && sidebarOpen) {
    return <ExpandedSidebar onClose={closeSidebar} transition={transition} />
  }

  // Collapsed pill — position depends on screen size
  if (isDesktop) {
    return (
      <DesktopPill
        tabs={tabs}
        pathname={pathname}
        onToggleSidebar={toggleSidebar}
        onCreateFlight={async () => {
          const draft = await createFlight()
          router.push(`/logbook?selected=${draft.id}`)
        }}
        transition={transition}
      />
    )
  }

  return (
    <MobilePill
      tabs={tabs}
      pathname={pathname}
      hideNavbar={hideNavbar}
      onCreateFlight={async () => {
        const draft = await createFlight()
        router.push(`/logbook?selected=${draft.id}`)
      }}
      transition={transition}
    />
  )
}

/** Desktop: top floating pill with sidebar toggle */
function DesktopPill({
  tabs,
  pathname,
  onToggleSidebar,
  onCreateFlight,
  transition,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  onToggleSidebar: () => void
  onCreateFlight: () => void
  transition: typeof springTransition | typeof instantTransition
}) {
  return (
    <motion.div
      className="fixed z-[100] top-[calc(env(safe-area-inset-top,0px)+0.5rem)] left-1/2"
      initial={{ x: "-50%", opacity: 0, scale: 0.95 }}
      animate={{ x: "-50%", opacity: 1, scale: 1 }}
      transition={transition}
    >
      <GlassContainer cornerRadius={24}>
        <nav className="flex items-center gap-1 px-2 h-12">
          {/* Sidebar toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="h-9 w-9 text-foreground/70 hover:text-foreground flex-shrink-0"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>

          <div className="w-px h-6 bg-border/50 mx-1" />

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
                    "h-9 w-9",
                    active ? "text-primary" : "text-foreground/60 hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </Button>
              </Link>
            )
          })}

          <div className="w-px h-6 bg-border/50 mx-1" />

          {/* New flight FAB */}
          <Button
            size="icon"
            className="h-9 w-9 rounded-full"
            onClick={onCreateFlight}
          >
            <Plus className="h-5 w-5" />
          </Button>
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

          <Button
            size="lg"
            className="h-12 w-12 rounded-full shadow-lg flex-shrink-0"
            onClick={onCreateFlight}
          >
            <Plus className="h-6 w-6" />
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
  )
}

/** Expanded sidebar — pushes content, shown on desktop only */
function ExpandedSidebar({
  onClose,
  transition,
}: {
  onClose: () => void
  transition: typeof springTransition | typeof instantTransition
}) {
  const pathname = usePathname()

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  return (
    <motion.aside
      className="flex-shrink-0 flex flex-col h-full overflow-hidden"
      initial={{ width: 0 }}
      animate={{ width: 256 }}
      exit={{ width: 0 }}
      transition={transition}
    >
      <GlassContainer
        cornerRadius={0}
        className="h-full"
        contentClassName="h-full"
      >
        <div className="flex flex-col h-full min-w-64">
          {/* Header with close button */}
          <div className="h-12 flex-shrink-0 flex items-center justify-between px-4 border-b border-border/30 mt-safe">
            <span className="text-sm font-semibold text-foreground/70">Navigation</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-foreground/70 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Navigation sections */}
          <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
            {/* Dashboard — standalone link above sections */}
            <div className="px-1">
              <NavItemLink
                item={dashboardNavItem}
                isActive={isItemActive("/")}
              />
            </div>
            {navSections.map((section) => (
              <NavSectionGroup key={section.label} section={section} />
            ))}
          </nav>
        </div>
      </GlassContainer>
    </motion.aside>
  )
}

/**
 * Wrapper that provides the sidebar push layout for desktop.
 * Renders the expanded sidebar + children in a flex row so the sidebar pushes content.
 */
export function NavPillLayout({ children }: { children: React.ReactNode }) {
  const isDesktop = useIsDesktop()
  const { isOpen: sidebarOpen, close: closeSidebar } = useSidebar()
  const prefersReducedMotion = useReducedMotion()
  const transition = prefersReducedMotion ? instantTransition : springTransition

  return (
    <div className="flex h-full w-full">
      {/* Desktop expanded sidebar — rendered here to push content */}
      <AnimatePresence>
        {isDesktop && sidebarOpen && (
          <ExpandedSidebar onClose={closeSidebar} transition={transition} />
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
