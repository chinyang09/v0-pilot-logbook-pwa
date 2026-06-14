/**
 * Error handling utilities
 * Centralized error handling patterns for consistent user feedback
 */

/**
 * Default timeout for success messages before closing dialog
 */
export const SUCCESS_TIMEOUT_MS = 1000

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown, defaultMessage = "An error occurred"): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  return defaultMessage
}

/**
 * Log error to console with context
 */
export function logError(context: string, error: unknown): void {
  console.error(`${context}:`, error)
}
