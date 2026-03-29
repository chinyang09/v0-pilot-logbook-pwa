"use client"

import { useReducedMotion } from "framer-motion"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { useCanPushSidebar } from "@/hooks/use-is-desktop"

const SIDEBAR_WIDTH = 220

/**
 * Push sidebar spacer — invisible flex child that animates width
 * to push content when the sidebar is open.
 *
 * Only pushes content when viewport is wide enough (>= 940px) to fit
 * sidebar + main panel + detail panel. On narrower desktops (720-939px),
 * the sidebar overlays content instead.
 */
export function PushSidebar() {
  const { isOpen } = useSidebar()
  const canPush = useCanPushSidebar()
  const prefersReducedMotion = useReducedMotion()

  return (
    <div
      className="h-full flex-shrink-0"
      style={{
        width: isOpen && canPush ? SIDEBAR_WIDTH : 0,
        transition: prefersReducedMotion ? "none" : "width 200ms cubic-bezier(0.25, 0.1, 0.25, 1)",
      }}
    />
  )
}
