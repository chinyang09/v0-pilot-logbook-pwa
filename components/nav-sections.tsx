"use client"

import {
  LayoutDashboard,
  Book,
  Plane,
  MapPin,
  Users,
  Award,
  Calendar,
  AlertTriangle,
  Clock,
  UserCircle,
  Settings,
} from "lucide-react"

export interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

export interface NavSection {
  label: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    label: "Logbook",
    items: [
      { label: "Logbook", href: "/logbook", icon: <Book className="h-4 w-4" /> },
      { label: "Aircraft", href: "/aircraft", icon: <Plane className="h-4 w-4" /> },
      { label: "Airports", href: "/airports", icon: <MapPin className="h-4 w-4" /> },
      { label: "Crew", href: "/crew", icon: <Users className="h-4 w-4" /> },
      { label: "Currencies", href: "/currencies", icon: <Award className="h-4 w-4" /> },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Roster", href: "/roster", icon: <Calendar className="h-4 w-4" /> },
      { label: "FDP", href: "/fdp", icon: <Clock className="h-4 w-4" /> },
      { label: "Discrepancies", href: "/discrepancies", icon: <AlertTriangle className="h-4 w-4" /> },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Account", href: "/account", icon: <UserCircle className="h-4 w-4" /> },
      { label: "Settings", href: "/settings", icon: <Settings className="h-4 w-4" /> },
    ],
  },
]

export const dashboardNavItem: NavItem = {
  label: "Dashboard",
  href: "/",
  icon: <LayoutDashboard className="h-4 w-4" />,
}
