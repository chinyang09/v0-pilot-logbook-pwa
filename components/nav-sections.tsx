"use client"

import {
  Gauge,
  ChartColumn,
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
  MessageSquarePlus,
  ArrowDownUp,
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
 * Nov 2026): what am I legal for, what have I flown, the record — three rows
 * of their own, no heading over them (the owner: "flight deck, summary and
 * logbook, each its own") — then the reference data it is written against,
 * the rules it is checked against, what comes in and goes out, and the app.
 */
export const navSections: NavSection[] = [
  {
    label: "Home",
    heading: false,
    items: [
      { label: "Flight Deck", href: "/", icon: <Gauge className="h-4 w-4" />, description: "This or the next duty, at a glance" },
      { label: "Summary", href: "/summary", icon: <ChartColumn className="h-4 w-4" />, description: "What you have flown, by period" },
      { label: "Logbook", href: "/logbook", icon: <Book className="h-4 w-4" />, description: "Your primary flight records" },
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
      {
        label: "Import & Export",
        href: "/import",
        icon: <ArrowDownUp className="h-4 w-4" />,
        description: "Company reports, briefings, LogTen",
      },
      { label: "Bin", href: "/recently-deleted", icon: <Trash2 className="h-4 w-4" /> },
      {
        label: "Feedback",
        href: "/feedback",
        icon: <MessageSquarePlus className="h-4 w-4" />,
        description: "Report a bug or ask for a change",
      },
    ],
  },
]

/** Every nav destination, in sidebar order. */
export const navHrefs: string[] = navSections.flatMap((s) => s.items.map((i) => i.href))
