"use client"

import type React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"

/**
 * Animated border glow shown around its children while `active`.
 *
 * The glow is a `box-shadow` on a transparent overlay sized to the content, so
 * it renders strictly OUTSIDE the box — it can never appear in the centre (the
 * previous behind-the-element approaches bled through the translucent OTP). A
 * crisp ring + soft halos breathe between dim and bright, reading as a glowing
 * animated border. Pure declarative framer-motion (no CSS mask), so it renders
 * reliably on iOS Safari.
 */
export function BorderGlow({
  active,
  children,
  className,
  radius = "0.5rem",
  duration = 1.6,
  color = "255, 210, 80", // amber, as "r, g, b"
}: {
  active: boolean
  children: React.ReactNode
  className?: string
  radius?: string
  duration?: number
  color?: string
}) {
  const dim =
    `0 0 0 1px rgba(${color}, 0.45), 0 0 6px 0 rgba(${color}, 0.22), 0 0 16px 2px rgba(${color}, 0.10)`
  const bright =
    `0 0 0 1.5px rgba(${color}, 0.95), 0 0 14px 2px rgba(${color}, 0.6), 0 0 32px 7px rgba(${color}, 0.28)`

  return (
    <div className={cn("relative", className)}>
      <AnimatePresence>
        {active && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ borderRadius: radius, background: "transparent" }}
            initial={{ opacity: 0, boxShadow: dim }}
            animate={{ opacity: 1, boxShadow: [dim, bright, dim] }}
            exit={{ opacity: 0 }}
            transition={{
              boxShadow: { duration, ease: "easeInOut", repeat: Infinity },
              opacity: { duration: 0.2 },
            }}
          />
        )}
      </AnimatePresence>
      {children}
    </div>
  )
}
