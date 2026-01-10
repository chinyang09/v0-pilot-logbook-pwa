/**
 * API error types
 */

export interface ApiError {
  code: string
  message: string
  details?: Record<string, any>
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "SYNC_ERROR"

export class ApiException extends Error {
  code: ApiErrorCode
  details?: Record<string, any>

  constructor(code: ApiErrorCode, message: string, details?: Record<string, any>) {
    super(message)
    this.code = code
    this.details = details
    this.name = "ApiException"
  }
}
