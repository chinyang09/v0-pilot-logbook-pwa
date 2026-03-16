"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
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
  ChevronDown,
} from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useState } from "react"

export interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

export interface NavSection {
  label: string
  items: NavItem[]
  defaultOpen?: boolean
}

export const navSections: NavSection[] = [
  {
    label: "Logbook",
    defaultOpen: true,
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
    defaultOpen: true,
    items: [
      { label: "Roster", href: "/roster", icon: <Calendar className="h-4 w-4" /> },
      { label: "FDP", href: "/fdp", icon: <Clock className="h-4 w-4" /> },
      { label: "Discrepancies", href: "/discrepancies", icon: <AlertTriangle className="h-4 w-4" /> },
    ],
  },
  {
    label: "Account",
    defaultOpen: false,
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

export function NavItemLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
        isActive
          ? "bg-sidebar-accent text-primary font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
    >
      <span className={cn(isActive ? "text-primary" : "text-sidebar-foreground/50")}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  )
}

export function NavSectionGroup({ section }: { section: NavSection }) {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(section.defaultOpen ?? true)

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground/70">
        {section.label}
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-200",
            isOpen ? "rotate-0" : "-rotate-90"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5 px-1">
        {section.items.map((item) => (
          <NavItemLink
            key={item.href}
            item={item}
            isActive={isItemActive(item.href)}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
