"use client"

import { Loader2 } from "lucide-react"

/**
 * Full-screen, app-themed status overlay used for blocking-but-quick async
 * transitions (logout, first-login initial sync) so the user always gets
 * immediate feedback instead of a frozen UI.
 */
export function AppStatusOverlay({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background/90 backdrop-blur-sm safe-area-inset"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <div className="text-center px-6">
        <p className="text-base font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
    </div>
  )
}
