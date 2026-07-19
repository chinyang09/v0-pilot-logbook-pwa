"use client"

import type React from "react"
import { GlassContainer } from "@/components/ui/glass-container"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The floating liquid-glass header-control system. Every header/detail action
 * across the app is built from these primitives so geometry, radius (28px pill)
 * and the FULL glass material stay identical everywhere — never hand-build
 * `GlassContainer > Button` blocks or introduce reduced glass variants:
 *
 * - `GlassIconButton` — a standalone icon action in its own glass pill (56px).
 * - `GlassTextButton` — a standalone text action in its own glass pill
 *   (56px tall, e.g. detail-panel Edit / Cancel / Save).
 * - `GlassButtonGroup` — a glass pill holding several 48px controls; use
 *   `GlassGroupButton` for icon actions inside it, or pass custom children
 *   (month picker label, period pills, import/alerts triggers).
 * - `GlassSearchButton` (components/ui/glass-search-button.tsx) — the
 *   expanding search control; collapsed it matches `GlassIconButton`.
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
    <GlassContainer cornerRadius={28}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        onClick={onClick}
        disabled={disabled}
        className={cn("h-14 w-14 rounded-full [&_svg]:!size-6", className)}
      >
        {children}
      </Button>
    </GlassContainer>
  )
}

export function GlassTextButton({
  onClick,
  disabled,
  primary = false,
  className,
  children,
}: {
  onClick?: () => void
  disabled?: boolean
  /** Emphasized (primary-colored, semibold) — e.g. Save / Edit. */
  primary?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <GlassContainer cornerRadius={28}>
      <Button
        variant="ghost"
        onClick={onClick}
        disabled={disabled}
        className={cn("h-14 px-4 rounded-full", primary && "text-primary font-semibold", className)}
      >
        {children}
      </Button>
    </GlassContainer>
  )
}

export function GlassButtonGroup({ children }: { children: React.ReactNode }) {
  return (
    <GlassContainer cornerRadius={28}>
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
      className={cn("h-12 w-12 rounded-full [&_svg]:!size-[22px]", active && "text-primary bg-primary/15", className)}
    >
      {children}
    </Button>
  )
}
