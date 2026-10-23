"use client"

/**
 * An action in a detail panel — "Restore", "Reopen", "Open flight" — as a
 * full-width CAPSULE on the app's action surface (`.control-surface` in
 * globals.css), the same thing a header control or a swipe button is.
 *
 * It used to be a ROW of a grouped section with its label in the accent, so
 * the only thing separating "press this" from "read this" was a colour. The
 * rule now: a thing you press is a capsule on the control face; a thing you
 * read is a row or a card. Several actions go in an `ActionStack`.
 */

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function ActionRow({
  label,
  onClick,
  destructive = false,
  primary = false,
  disabled = false,
  icon,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  /** The panel's main thing to do — the selected-thing fill. */
  primary?: boolean
  disabled?: boolean
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "control-surface flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-[15px] font-medium",
        "disabled:opacity-50 [&_svg]:h-[18px] [&_svg]:w-[18px]",
        destructive && "control-surface-destructive",
        primary && !destructive && "control-surface-primary"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** A panel's actions, stacked under its content. */
export function ActionStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 pt-1">{children}</div>
}
