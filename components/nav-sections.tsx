"use client"

import {
  LayoutDashboard,
  Book,
  Plane,
  MapPin,
  Users,
  Award,
  AlertTriangle,
  Clock,
  UserCircle,
  Settings,
  Trash2,
} from "lucide-react"

export interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  /** What the page holds, said once — the link's tooltip and accessible description. */
  description?: string
}

export interface NavSection {
  label: string
  /**
   * Whether the section draws its heading. A section whose one item carries
   * the section's own name ("Dashboard", "Logbook") does not: a heading
   * reading LOGBOOK over a row reading Logbook is one word twice, and a
   * collapse chevron over a single row hides nothing worth hiding.
   */
  heading: boolean
  items: NavItem[]
}

/**
 * The sidebar, in the order a pilot reaches for it (the owner's structure,
 * Nov 2026): what am I legal for → the record → the reference data it is
 * written against → the rules it is checked against → the app itself.
 */
export const navSections: NavSection[] = [
  {
    label: "Dashboard",
    heading: false,
    items: [{ label: "Dashboard", href: "/", icon: <LayoutDashboard className="h-4 w-4" /> }],
  },
  {
    label: "Logbook",
    heading: false,
    items: [
      {
        label: "Logbook",
        href: "/logbook",
        icon: <Book className="h-4 w-4" />,
        description: "Your primary flight records",
      },
    ],
  },
  {
    label: "Database",
    heading: true,
    items: [
      { label: "Aircraft", href: "/aircraft", icon: <Plane className="h-4 w-4" />, description: "Master fleet records" },
      { label: "Airports", href: "/airports", icon: <MapPin className="h-4 w-4" />, description: "Aerodrome database" },
      { label: "Crew", href: "/crew", icon: <Users className="h-4 w-4" />, description: "Colleague and pilot directory" },
    ],
  },
  {
    label: "Duty & Compliance",
    heading: true,
    items: [
      { label: "Currencies", href: "/currencies", icon: <Award className="h-4 w-4" /> },
      { label: "FDP", href: "/fdp", icon: <Clock className="h-4 w-4" /> },
      { label: "Discrepancies", href: "/discrepancies", icon: <AlertTriangle className="h-4 w-4" /> },
    ],
  },
  {
    label: "System",
    heading: true,
    items: [
      { label: "Account", href: "/account", icon: <UserCircle className="h-4 w-4" /> },
      { label: "Settings", href: "/settings", icon: <Settings className="h-4 w-4" /> },
      { label: "Bin", href: "/recently-deleted", icon: <Trash2 className="h-4 w-4" /> },
    ],
  },
]

/** Every nav destination, in sidebar order. */
export const navHrefs: string[] = navSections.flatMap((s) => s.items.map((i) => i.href))
