"use client"

import { motion, useReducedMotion } from "framer-motion"
import { useSidebar } from "@/hooks/use-sidebar-context"

const SIDEBAR_WIDTH = 288

const springTransition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
}

const instantTransition = {
  duration: 0,
}

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

  const transition = prefersReducedMotion ? instantTransition : springTransition

  return (
    <motion.div
      className="h-full flex-shrink-0"
      animate={{ width: isOpen ? SIDEBAR_WIDTH : 0 }}
      initial={false}
      transition={transition}
    />
  )
}
