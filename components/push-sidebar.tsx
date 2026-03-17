"use client"

import type React from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { PanelLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { GlassContainer } from "@/components/ui/glass-container"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { navSections, dashboardNavItem } from "@/components/nav-sections"

const SIDEBAR_WIDTH = 288 // w-72
const SIDEBAR_PADDING = 12 // inset padding for floating card effect

const springTransition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
}

const instantTransition = {
  duration: 0,
}

/**
 * Push sidebar — sits in the flex flow as a sibling before the main content.
 * Animates width between 0 and SIDEBAR_WIDTH via framer-motion spring.
 * Pushes both main panel and detail panel to the right.
 *
 * GitHub Mobile-style: floating card with rounded corners on all sides.
 * Desktop only — parent gates rendering with `isDesktop`.
 */
export function PushSidebar() {
  const { isOpen, close } = useSidebar()
  const pathname = usePathname()
  const prefersReducedMotion = useReducedMotion()

  const transition = prefersReducedMotion ? instantTransition : springTransition

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  return (
    <motion.div
      className="h-full flex-shrink-0 overflow-hidden"
      animate={{ width: isOpen ? SIDEBAR_WIDTH : 0 }}
      initial={false}
      transition={transition}
    >
      {/* Inner container at fixed width — content never reflows during width animation */}
      <div className="h-full" style={{ width: SIDEBAR_WIDTH }}>
        {/* Floating card with inset padding — rounded corners on all sides */}
        <div
          className="h-full"
          style={{ padding: `${SIDEBAR_PADDING}px ${SIDEBAR_PADDING}px ${SIDEBAR_PADDING}px ${SIDEBAR_PADDING}px` }}
        >
          <motion.div
            className="h-full"
            initial={false}
            animate={{
              opacity: isOpen ? 1 : 0,
              visibility: isOpen ? "visible" as const : "hidden" as const,
            }}
            transition={{
              opacity: { duration: prefersReducedMotion ? 0 : 0.15 },
              visibility: { delay: isOpen ? 0 : 0.15 },
            }}
          >
            <GlassContainer
              cornerRadius={20}
              className="h-full"
              contentClassName="h-full"
            >
              <div className="flex flex-col h-full">
                {/* Close button — top right */}
                <div className="h-12 flex-shrink-0 flex items-center justify-end px-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={close}
                    className="h-9 w-9 text-foreground/60 hover:text-foreground"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </div>

                {/* Flat nav list — GitHub Mobile style, no section headers */}
                <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
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
                </nav>
              </div>
            </GlassContainer>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}

/** Single sidebar nav item — flat, GitHub Mobile style */
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
