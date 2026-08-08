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
/**
 * The shared corner radius. It has to be half the control height or the pill
 * stops being a stadium — 22 for the 44px controls (they were 56/28, sized to
 * match another app's chrome on the same iPad, which read as oversized).
 */
const CONTROL_RADIUS = 22

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
    <GlassContainer cornerRadius={CONTROL_RADIUS}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        onClick={onClick}
        disabled={disabled}
        className={cn("h-11 w-11 rounded-full [&_svg]:!size-5", className)}
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
    <GlassContainer cornerRadius={CONTROL_RADIUS}>
      <Button
        variant="ghost"
        onClick={onClick}
        disabled={disabled}
        className={cn("h-11 px-3.5 rounded-full text-sm", primary && "text-primary font-semibold", className)}
      >
        {children}
      </Button>
    </GlassContainer>
  )
}

export function GlassButtonGroup({ children }: { children: React.ReactNode }) {
  return (
    <GlassContainer cornerRadius={CONTROL_RADIUS}>
      <div className="flex items-center gap-0.5 px-1 h-11">{children}</div>
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
      className={cn(
        "h-9 w-9 rounded-full [&_svg]:!size-[19px]",
        // `--on-glass-active` is THE selected-thing fill, shared with the nav's
        // gravity blob — see the token. Its foreground is a separate token
        // because `--primary` on a 32% tint of itself is the same hue at a
        // similar lightness, which is what made this read as barely selected.
        active && "text-[var(--on-glass-active-fg)] bg-[var(--on-glass-active)]",
        className
      )}
    >
      {children}
    </Button>
  )
}
