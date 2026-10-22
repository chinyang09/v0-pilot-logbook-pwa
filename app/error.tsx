"use client"

import { ErrorScreen } from "@/components/ui/error-screen"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorScreen error={error} onRetry={reset} message="An unexpected error occurred. Please try again." fullScreen />
}
