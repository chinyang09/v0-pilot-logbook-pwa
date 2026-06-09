import type React from "react"
import { cn } from "@/lib/utils"

/**
 * A grouped settings card with an optional uppercase section header — the shared
 * section layout used across the flight, crew, and aircraft forms.
 *
 * Rows (SettingsRow / ToggleRow / etc.) are placed directly inside; they bring
 * their own horizontal padding so swipe-to-reveal actions can span the full
 * card width.
 */
export function FormSection({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-xl bg-card border border-border overflow-hidden",
        className
      )}
    >
      {title && (
        <div className="px-4 py-2 bg-muted/30">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {title}
          </h2>
        </div>
      )}
      {children}
    </div>
  )
}
