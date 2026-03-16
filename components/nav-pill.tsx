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
 * Unified floating nav pill component.
 *
 * - Mobile (<768px): Bottom floating pill with 4 nav icons + center FAB
 * - Desktop (≥768px): Top floating pill with sidebar toggle + 4 nav icons + FAB
 *   Sidebar is a fixed overlay (GitHub Mobile style), not a push sidebar
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

  const handleCreateFlight = async () => {
    const draft = await createFlight()
    router.push(`/logbook?selected=${draft.id}`)
  }

  return (
    <>
      {/* Nav pill — always rendered */}
      {isDesktop ? (
        <DesktopPill
          tabs={tabs}
          pathname={pathname}
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
      )}

      {/* Sidebar overlay — desktop only, rendered as fixed overlay */}
      <AnimatePresence>
        {isDesktop && sidebarOpen && (
          <SidebarOverlay
            onClose={closeSidebar}
            transition={transition}
            prefersReducedMotion={!!prefersReducedMotion}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/** Desktop: top floating pill with sidebar toggle — 1.2x scaled */
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

/** GitHub Mobile-style sidebar overlay — fixed position, not push */
function SidebarOverlay({
  onClose,
  transition,
  prefersReducedMotion,
}: {
  onClose: () => void
  transition: typeof springTransition | typeof instantTransition
  prefersReducedMotion: boolean
}) {
  const pathname = usePathname()

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  return (
    <>
      {/* Scrim */}
      <motion.div
        className="fixed inset-0 z-[90] bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2 }}
        onClick={onClose}
      />

      {/* Sidebar panel */}
      <motion.div
        className="fixed top-0 left-0 bottom-0 z-[100] w-72 pt-safe"
        initial={{ x: "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: "-100%" }}
        transition={transition}
      >
        <GlassContainer
          cornerRadius={0}
          className="h-full"
          contentClassName="h-full"
          style={{ "--corner-radius": "0px 20px 20px 0px" } as React.CSSProperties}
        >
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="h-14 flex-shrink-0 flex items-center justify-between px-4">
              <span className="text-sm font-semibold text-foreground/70">Navigation</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-9 w-9 text-foreground/70 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Flat nav list — GitHub Mobile style */}
            <nav className="flex-1 overflow-y-auto px-3 pb-4">
              {/* Dashboard */}
              <SidebarNavItem
                href={dashboardNavItem.href}
                icon={dashboardNavItem.icon}
                label={dashboardNavItem.label}
                isActive={isItemActive("/")}
                onClick={onClose}
              />

              {/* Sections with flat items */}
              {navSections.map((section) => (
                <div key={section.label}>
                  <div className="h-px bg-border/30 my-2 mx-1" />
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/40 px-3 py-2">
                    {section.label}
                  </p>
                  {section.items.map((item) => (
                    <SidebarNavItem
                      key={item.href}
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                      isActive={isItemActive(item.href)}
                      onClick={onClose}
                    />
                  ))}
                </div>
              ))}
            </nav>
          </div>
        </GlassContainer>
      </motion.div>
    </>
  )
}

/** Single sidebar nav item — flat, GitHub Mobile style */
function SidebarNavItem({
  href,
  icon,
  label,
  isActive,
  onClick,
}: {
  href: string
  icon: React.ReactNode
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
        isActive
          ? "text-primary font-medium"
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
