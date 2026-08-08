"use client"

import { useReducedMotion } from "framer-motion"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { useDesktopPill } from "@/hooks/use-is-desktop"
import { SIDEBAR_WIDTH_PX as SIDEBAR_WIDTH } from "@/lib/layout/panel-widths"

/**
 * Push sidebar spacer — invisible flex child that animates width
 * to push content when the sidebar is open.
 *
 * Gated on the DESKTOP-PILL breakpoint (>= 1120px), because that's the only
 * tier where the sidebar UI (the pill↔sidebar morph) exists. Gating on the
 * narrower >=920 tier reserved a 199px phantom column on iPad-sized windows:
 * the persisted sidebar-open state pushed content right while the nav was the
 * bottom mobile pill and nothing rendered in the gap.
 */
export function PushSidebar() {
  const { isOpen } = useSidebar()
  const canPush = useDesktopPill()
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
