"use client"

import type React from "react"
import { useEffect } from "react"
import {
  AnimatePresence,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
} from "framer-motion"
import { cn } from "@/lib/utils"

/**
 * Animated glow-border ("border beam") shown behind its children while `active`.
 *
 * A localized bright arc in a conic gradient is swept around the perimeter by
 * animating the gradient's `from` angle (a motion value), with a small blur so
 * the highlight reads as a glow travelling around the border. Rendered behind
 * the content (children at z-10) and slightly larger, so only the edge glow
 * shows.
 *
 * Pure framer-motion: animating the gradient angle (not rotating the element)
 * avoids a rotating square, and there is no CSS `mask-composite` — so it renders
 * reliably on iOS Safari (the previous mask approach filled the centre there).
 */
export function BorderBeam({
  active,
  children,
  className,
  radius = "0.6rem",
  duration = 2,
  color = "rgba(255, 210, 80, 1)",
}: {
  active: boolean
  children: React.ReactNode
  className?: string
  radius?: string
  duration?: number
  color?: string
}) {
  const angle = useMotionValue(0)

  useEffect(() => {
    if (!active) return
    const controls = animate(angle, 360, {
      duration,
      ease: "linear",
      repeat: Infinity,
    })
    return () => controls.stop()
  }, [active, angle, duration])

  const background = useMotionTemplate`conic-gradient(from ${angle}deg, transparent 0deg 275deg, ${color} 318deg, #ffffff 336deg, ${color} 348deg, transparent 360deg)`

  return (
    <div className={cn("relative", className)}>
      <AnimatePresence>
        {active && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-[3px] z-0"
            style={{ background, borderRadius: radius, filter: "blur(5px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>
      <div className="relative z-10">{children}</div>
    </div>
  )
}
