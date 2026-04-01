"use client"

import { useEffect } from "react"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[v0] App section error boundary caught:", error)
  }, [error])

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4">
      <div className="text-center max-w-sm">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Something went wrong
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          An error occurred while loading this page. Your data is safe.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium rounded-md bg-secondary text-secondary-foreground border border-border hover:bg-accent transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Reload App
          </button>
        </div>
      </div>
    </div>
  )
}
