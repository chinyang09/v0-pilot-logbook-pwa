"use client"

/**
 * What every error boundary shows — and the one place a page whose code is
 * from an old deploy is reloaded instead of reported (`chunk-recovery.ts`).
 */

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { canRecoverFromChunkError, isChunkLoadError, recoverFromChunkError } from "@/lib/utils/chunk-recovery"
import { cn } from "@/lib/utils"

export function ErrorScreen({
  error,
  title = "Something went wrong",
  message = "An error occurred while loading this page. Your data is safe.",
  onRetry,
  fullScreen = false,
}: {
  error: unknown
  title?: string
  message?: string
  onRetry?: () => void
  fullScreen?: boolean
}) {
  // Decided once, at mount: a chunk failure we have not just reloaded for.
  const [updating] = useState(() => isChunkLoadError(error) && canRecoverFromChunkError())

  useEffect(() => {
    if (updating) void recoverFromChunkError()
    else console.error("[v0] Error boundary caught:", error)
  }, [updating, error])

  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center bg-background px-4",
        fullScreen && "min-h-screen"
      )}
    >
      {updating ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading the latest version…
        </div>
      ) : (
        <div className="max-w-sm text-center">
          <h2 className="mb-1 text-lg font-semibold text-foreground">{title}</h2>
          <p className="mb-6 text-sm text-muted-foreground">{message}</p>
          <div className="flex justify-center gap-3">
            {onRetry && (
              <button
                onClick={onRetry}
                className="h-9 rounded-md border border-border bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
              >
                Try again
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Reload app
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
