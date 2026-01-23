"use client"

import { useState, useCallback } from "react"
import { getErrorMessage, logError, SUCCESS_TIMEOUT_MS } from "@/lib/utils/error-handling"

/**
 * Options for the useFormSubmit hook
 */
export interface UseFormSubmitOptions {
  /** Context for error logging (e.g., "save currency") */
  context: string
  /** Callback when submission succeeds (called after success timeout) */
  onSuccess?: () => void
  /** Callback when submission fails */
  onError?: (message: string) => void
  /** Duration to show success state before calling onSuccess (default: 1000ms) */
  successTimeout?: number
}

/**
 * Return type for useFormSubmit hook
 */
export interface UseFormSubmitReturn<T> {
  /** Whether the form is currently submitting */
  isSubmitting: boolean
  /** Whether the submission was successful (briefly true before closing) */
  showSuccess: boolean
  /** Error message if submission failed */
  error: string | null
  /** Submit handler to wrap your async submission logic */
  handleSubmit: (submitFn: () => Promise<T>) => Promise<T | null>
  /** Reset the form state (clear error, success) */
  reset: () => void
  /** Clear the error state */
  clearError: () => void
}

/**
 * Hook for handling form submissions with loading, success, and error states
 *
 * @example
 * ```tsx
 * const { isSubmitting, showSuccess, handleSubmit } = useFormSubmit({
 *   context: "save currency",
 *   onSuccess: () => {
 *     onOpenChange(false)
 *     onSaved?.()
 *   },
 *   onError: (message) => alert(message)
 * })
 *
 * const onSave = () => handleSubmit(async () => {
 *   await saveCurrency(data)
 * })
 * ```
 */
export function useFormSubmit<T = void>(
  options: UseFormSubmitOptions
): UseFormSubmitReturn<T> {
  const {
    context,
    onSuccess,
    onError,
    successTimeout = SUCCESS_TIMEOUT_MS,
  } = options

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setIsSubmitting(false)
    setShowSuccess(false)
    setError(null)
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const handleSubmit = useCallback(
    async (submitFn: () => Promise<T>): Promise<T | null> => {
      setIsSubmitting(true)
      setError(null)

      try {
        const result = await submitFn()

        setShowSuccess(true)
        setTimeout(() => {
          setShowSuccess(false)
          onSuccess?.()
        }, successTimeout)

        return result
      } catch (err) {
        const message = getErrorMessage(err, `Failed to ${context}`)
        logError(`Failed to ${context}`, err)
        setError(message)
        onError?.(message)
        return null
      } finally {
        setIsSubmitting(false)
      }
    },
    [context, onSuccess, onError, successTimeout]
  )

  return {
    isSubmitting,
    showSuccess,
    error,
    handleSubmit,
    reset,
    clearError,
  }
}

/**
 * Simplified version that just provides loading state and error handling
 * without the success timeout pattern
 */
export function useAsyncAction<T = void>(
  context: string,
  onError?: (message: string) => void
): {
  isLoading: boolean
  error: string | null
  execute: (fn: () => Promise<T>) => Promise<T | null>
  clearError: () => void
} {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const execute = useCallback(
    async (fn: () => Promise<T>): Promise<T | null> => {
      setIsLoading(true)
      setError(null)

      try {
        const result = await fn()
        return result
      } catch (err) {
        const message = getErrorMessage(err, `Failed to ${context}`)
        logError(`Failed to ${context}`, err)
        setError(message)
        onError?.(message)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [context, onError]
  )

  return {
    isLoading,
    error,
    execute,
    clearError,
  }
}
