"use client"

import { ErrorScreen } from "@/components/ui/error-screen"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorScreen error={error} onRetry={reset} />
}
