/**
 * Session-related types for authentication
 */

export interface AuthContextType {
  user: import("../entities/user.types").UserSession | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (session: Omit<import("../entities/user.types").UserSession, "id" | "createdAt">) => Promise<void>
  logout: () => Promise<void>
  silentReauth: () => Promise<boolean>
}

export interface LoginCredentials {
  callsign: string
  totp?: string
}

export interface RegisterCredentials {
  callsign: string
}

export interface AuthResponse {
  success: boolean
  user?: {
    id: string
    callsign: string
  }
  session?: {
    token: string
    expiresAt: string
  }
  error?: string
}
