"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/hooks/use-sidebar-context"
import {
  Book,
  Plane,
  MapPin,
  Users,
  Award,
  Calendar,
  AlertTriangle,
  Clock,
  Database,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useState } from "react"

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

interface NavSection {
  label: string
  items: NavItem[]
  defaultOpen?: boolean
}

const navSections: NavSection[] = [
  {
    label: "Logbook",
    defaultOpen: true,
    items: [
      { label: "Flights & Duties", href: "/logbook", icon: <Book className="h-4 w-4" /> },
      { label: "Aircraft", href: "/aircraft", icon: <Plane className="h-4 w-4" /> },
      { label: "Places", href: "/airports", icon: <MapPin className="h-4 w-4" /> },
      { label: "People", href: "/crew", icon: <Users className="h-4 w-4" /> },
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
      { label: "Data", href: "/data", icon: <Database className="h-4 w-4" /> },
    ],
  },
]

function NavItemLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
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

function NavSectionGroup({ section }: { section: NavSection }) {
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

export function SidebarToggle() {
  const { isOpen, toggle } = useSidebar()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-muted"
    >
      {isOpen ? (
        <PanelLeftClose className="h-4 w-4" />
      ) : (
        <PanelLeft className="h-4 w-4" />
      )}
    </Button>
  )
}

export function SidebarNav() {
  const { isOpen } = useSidebar()

  return (
    <aside
      className={cn(
        "flex-shrink-0 flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out overflow-hidden",
        isOpen ? "w-64" : "w-0"
      )}
    >
      {/* Sidebar content */}
      <div
        className={cn(
          "flex flex-col flex-1 min-w-64 transition-opacity duration-200",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {/* Header with toggle button area */}
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border">
          <span className="text-sm font-semibold text-sidebar-foreground">Pilot Logbook</span>
        </div>

        {/* Navigation sections */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
          {navSections.map((section) => (
            <NavSectionGroup key={section.label} section={section} />
          ))}
        </nav>
      </div>
    </aside>
  )
}
