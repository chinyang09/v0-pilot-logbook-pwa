import type React from "react"
import {
  LayoutDashboard,
  Book,
  Calendar,
  Plane,
  Users,
  MapPin,
  Award,
  Clock,
  AlertTriangle,
  Settings,
  UserCircle,
  Trash2,
} from "lucide-react"
import type { BottomNavTab } from "@/types/db/stores.types"

/**
 * Every destination a tab bar can carry — the nav draws from it and Settings ›
 * Navigation previews and edits with it, so the two cannot disagree about a
 * tab's name, icon or page. The choices are the sidebar's own destinations
 * (`nav-sections.tsx`), in its order (`NAV_TAB_CHOICES`).
 */
export const TAB_CONFIG: Record<
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
    // The pages with no tab of their own that are ABOUT the logbook light it:
    // Duty & Compliance (Currencies, FDP, Discrepancies — the record checked
    // against the rules) and the Bin (deleted entries, mostly flights). The
    // roster is this list with its duties on, so the old Roster tab's pages
    // are among them.
    isActive: (p) =>
      p === "/logbook" ||
      p?.startsWith("/flights/") ||
      p === "/currencies" ||
      p === "/recently-deleted" ||
      p === "/discrepancies" ||
      p === "/fdp",
  },
  roster: {
    label: "Roster",
    icon: Calendar,
    href: "/roster",
    isActive: (p) =>
      p === "/roster" ||
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
  fdp: {
    label: "FDP",
    icon: Clock,
    href: "/fdp",
    isActive: (p) => p === "/fdp",
  },
  discrepancies: {
    label: "Discrepancies",
    icon: AlertTriangle,
    href: "/discrepancies",
    isActive: (p) => p === "/discrepancies",
  },
  bin: {
    label: "Bin",
    icon: Trash2,
    href: "/recently-deleted",
    isActive: (p) => p === "/recently-deleted",
  },
}

/** What Settings offers, in the sidebar's order. (Roster is not a tab: it is the logbook with its duties on.) */
export const NAV_TAB_CHOICES: readonly BottomNavTab[] = [
  "dashboard",
  "logbook",
  "aircraft",
  "airports",
  "crew",
  "currencies",
  "fdp",
  "discrepancies",
  "account",
  "settings",
  "bin",
]
