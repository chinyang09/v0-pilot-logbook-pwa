"use client"

import type React from "react"
import { GlassContainer } from "@/components/ui/glass-container"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The floating glass header-action primitives. Every page previously hand-built
 * `GlassContainer > Button` blocks with drifting sizes (h-14 vs h-12 singles,
 * gap-0.5 vs gap-1 groups) — these pin the geometry in one place:
 *
 * - `GlassIconButton` — a standalone action in its own glass pill (56px).
 * - `GlassButtonGroup` — a glass pill holding several 48px controls; use
 *   `GlassGroupButton` for plain icon actions inside it, or pass custom
 *   children (e.g. the logbook month picker, the import button).
 */
export function GlassIconButton({
  onClick,
  disabled,
  ariaLabel,
  className,
  children,
}: {
  onClick?: () => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <GlassContainer cornerRadius={28} lite>
      <Button
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        onClick={onClick}
        disabled={disabled}
        className={cn("h-14 w-14 rounded-full", className)}
      >
        {children}
      </Button>
    </GlassContainer>
  )
}

export function GlassButtonGroup({ children }: { children: React.ReactNode }) {
  return (
    <GlassContainer cornerRadius={28} lite>
      <div className="flex items-center gap-1 px-1 h-14">{children}</div>
    </GlassContainer>
  )
}

export function GlassGroupButton({
  onClick,
  disabled,
  ariaLabel,
  ariaPressed,
  active,
  className,
  children,
}: {
  onClick?: () => void
  disabled?: boolean
  ariaLabel?: string
  ariaPressed?: boolean
  /** Highlight as the active option of a toggle group. */
  active?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={onClick}
      disabled={disabled}
      className={cn("h-12 w-12 rounded-full", active && "text-primary bg-primary/15", className)}
    >
      {children}
    </Button>
  )
}
