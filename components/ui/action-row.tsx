"use client"

/**
 * A row that DOES something, inside a grouped `FormSection` — "Reopen",
 * "Open flight", "Restore". The settings-list idiom for an action: the label
 * in the accent (or destructive red), a chevron at the end, the whole row the
 * target. A full-width filled button in a detail pane reads as a web form.
 */

import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export function ActionRow({
  label,
  onClick,
  destructive = false,
  disabled = false,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "row-divider flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors active:bg-muted/50 disabled:opacity-50",
        destructive ? "text-destructive" : "text-primary"
      )}
    >
      <span>{label}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
    </button>
  )
}
