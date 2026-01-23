/**
 * Error handling utilities
 * Centralized error handling patterns for consistent user feedback
 */

/**
 * Default timeout for success messages before closing dialog
 */
export const SUCCESS_TIMEOUT_MS = 1000

/**
 * Default timeout for error messages display
 */
export const ERROR_TIMEOUT_MS = 3000

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

/**
 * Handle async operation error with logging and user notification
 * Returns the error message for use in UI
 */
export function handleAsyncError(
  context: string,
  error: unknown,
  notify?: (message: string) => void
): string {
  const message = getErrorMessage(error, `Failed to ${context.toLowerCase()}`)
  logError(context, error)

  if (notify) {
    notify(message)
  }

  return message
}

/**
 * Options for withErrorHandling wrapper
 */
export interface WithErrorHandlingOptions {
  /** Context for error logging (e.g., "save flight") */
  context: string
  /** Callback for error notification */
  onError?: (message: string) => void
  /** Callback for success */
  onSuccess?: () => void
  /** Whether to rethrow the error after handling */
  rethrow?: boolean
}

/**
 * Wrap an async function with error handling
 * Provides consistent logging and error reporting
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  options: WithErrorHandlingOptions
): Promise<T | null> {
  const { context, onError, onSuccess, rethrow = false } = options

  try {
    const result = await fn()
    onSuccess?.()
    return result
  } catch (error) {
    handleAsyncError(context, error, onError)
    if (rethrow) {
      throw error
    }
    return null
  }
}

/**
 * Create a wrapped async handler for form submissions
 * Manages loading state and error handling
 */
export function createAsyncHandler<T>(
  handler: () => Promise<T>,
  options: {
    setLoading: (loading: boolean) => void
    context: string
    onError?: (message: string) => void
    onSuccess?: () => void
  }
): () => Promise<T | null> {
  return async () => {
    options.setLoading(true)
    try {
      const result = await handler()
      options.onSuccess?.()
      return result
    } catch (error) {
      handleAsyncError(options.context, error, options.onError)
      return null
    } finally {
      options.setLoading(false)
    }
  }
}

/**
 * Standard error messages
 */
export const ERROR_MESSAGES = {
  NETWORK: "Network error. Please check your connection.",
  SAVE_FAILED: "Failed to save changes. Please try again.",
  DELETE_FAILED: "Failed to delete. Please try again.",
  LOAD_FAILED: "Failed to load data. Please try again.",
  VALIDATION: "Please check your input and try again.",
  UNAUTHORIZED: "You are not authorized to perform this action.",
  NOT_FOUND: "The requested item was not found.",
} as const

/**
 * Determine if an error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("connection") ||
      message.includes("offline")
    )
  }
  return false
}

/**
 * Create a validated alert function that won't crash on missing window.alert
 */
export function safeAlert(message: string): void {
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(message)
  } else {
    console.warn("Alert:", message)
  }
}
