"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { getUserSession, saveUserSession, clearAllUserData, type UserSession } from "@/lib/indexed-db"
import { startAuthentication } from "@simplewebauthn/browser"

interface AuthContextType {
  user: UserSession | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (session: Omit<UserSession, "id" | "createdAt">) => Promise<void>
  logout: () => Promise<void>
  silentReauth: () => Promise<boolean>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const authCheckDone = useRef(false)

  const login = useCallback(async (session: Omit<UserSession, "id" | "createdAt">) => {
    await saveUserSession(session)
    const savedSession = await getUserSession()
    setUser(savedSession || null)
  }, [])

  const logout = useCallback(async () => {
    // Clear server session cookie
    try {
      await fetch("/api/auth/session", { method: "DELETE" })
    } catch (error) {
      console.error("Failed to clear server session:", error)
    }

    // Clear local data
    await clearAllUserData()
    setUser(null)
    router.push("/login")
  }, [router])

  // Silent re-authentication using discoverable credentials (passkey)
  const silentReauth = useCallback(async (): Promise<boolean> => {
    try {
      console.log("[v0] Attempting silent re-auth with passkey...")

      // Get authentication options from server
      const optionsRes = await fetch("/api/auth/login/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      })

      if (!optionsRes.ok) {
        console.log("[v0] Silent re-auth: no passkey options available")
        return false
      }

      const { options } = await optionsRes.json()

      // Trigger WebAuthn - this will use resident/discoverable credentials
      const credential = await startAuthentication({ optionsJSON: options })

      // Verify with server
      const verifyRes = await fetch("/api/auth/login/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", credential }),
      })

      if (!verifyRes.ok) {
        console.log("[v0] Silent re-auth: verification failed")
        return false
      }

      const { user: userData, session } = await verifyRes.json()

      // Save session locally
      await saveUserSession({
        userId: userData.id,
        callsign: userData.callsign,
        sessionToken: session.token,
        expiresAt: new Date(session.expiresAt).getTime(),
      })

      const savedSession = await getUserSession()
      setUser(savedSession || null)

      console.log("[v0] Silent re-auth successful for:", userData.callsign)
      return true
    } catch (error) {
      // WebAuthn errors are expected if user cancels or no credential available
      console.log("[v0] Silent re-auth failed:", error)
      return false
    }
  }, [])

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (authCheckDone.current) return
      authCheckDone.current = true

      try {
        // First check IndexedDB for existing session
        const localSession = await getUserSession()

        if (localSession) {
          console.log("[v0] Found valid local session for:", localSession.callsign)
          setUser(localSession)
          setIsLoading(false)
          return
        }

        // No local session - try silent re-auth with passkey
        if (pathname !== "/login") {
          const reauthSuccess = await silentReauth()
          if (!reauthSuccess) {
            // No valid session and re-auth failed - redirect to login
            console.log("[v0] No valid session - redirecting to login")
            router.push("/login")
          }
        }
      } catch (error) {
        console.error("[v0] Auth check error:", error)
        if (pathname !== "/login") {
          router.push("/login")
        }
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [pathname, router, silentReauth])

  // Protect routes
  useEffect(() => {
    if (!isLoading && !user && pathname !== "/login") {
      router.push("/login")
    }
  }, [user, isLoading, pathname, router])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        silentReauth,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
