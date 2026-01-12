/**
 * API error type definitions
 */

/**
 * API error codes
 */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "RATE_LIMITED"
  | "SESSION_EXPIRED"
  | "INVALID_CREDENTIALS"

/**
 * API error response
 */
export interface ApiError {
  code: ApiErrorCode
  message: string
  details?: Record<string, unknown>
}

/**
 * Validation error
 */
export interface ValidationError {
  field: string
  message: string
}

/**
 * API error with validation
 */
export interface ApiValidationError extends ApiError {
  code: "VALIDATION_ERROR"
  details: {
    errors: ValidationError[]
  }
}
