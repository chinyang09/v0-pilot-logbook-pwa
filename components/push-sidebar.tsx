"use client"

import { useReducedMotion } from "framer-motion"
import { useSidebar } from "@/hooks/use-sidebar-context"

const SIDEBAR_WIDTH = 288

/**
 * Push sidebar spacer — invisible flex child that animates width
 * to push main content right when the sidebar is open.
 *
 * All visual content (glass, nav items) is rendered by the NavPill
 * morph component which overlays this spacer's area.
 */
export function PushSidebar() {
  const { isOpen } = useSidebar()
  const prefersReducedMotion = useReducedMotion()

  return (
    <div
      className="h-full flex-shrink-0"
      style={{
        width: isOpen ? SIDEBAR_WIDTH : 0,
        transition: prefersReducedMotion ? "none" : "width 200ms cubic-bezier(0.25, 0.1, 0.25, 1)",
      }}
    />
  )
}
