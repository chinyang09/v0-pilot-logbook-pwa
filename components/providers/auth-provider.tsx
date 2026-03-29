"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { getUserSession, saveUserSession, clearAllUserData, type UserSession } from "@/lib/db"
import { startAuthentication } from "@simplewebauthn/browser"

interface AuthContextType {
  user: UserSession | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (session: Omit<UserSession, "id" | "createdAt">) => Promise<void>
  logout: () => Promise<void>
  silentReauth: () => Promise<boolean>
  updateCallsign: (newCallsign: string) => Promise<void>
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

    // After successful login, trigger proactive caching of app pages
    if (savedSession && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.active) {
          registration.active.postMessage({
            type: "CACHE_PAGES",
            pages: ["/", "/logbook", "/new-flight", "/aircraft", "/airports", "/crew"],
          })
          console.log("[Auth] Triggered proactive page caching after login")
        }
      })
    }
  }, [])

  const logout = useCallback(async () => {
    // Sync pending changes before logout to prevent data loss
    try {
      const { syncService } = await import("@/lib/sync")
      await syncService.syncBeforeLogout()
    } catch (error) {
      console.error("[Auth] Pre-logout sync failed:", error)
    }

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

  const updateCallsign = useCallback(async (newCallsign: string) => {
    const currentSession = await getUserSession()
    if (!currentSession) return

    await saveUserSession({
      userId: currentSession.userId,
      callsign: newCallsign,
      sessionToken: currentSession.sessionToken,
      expiresAt: currentSession.expiresAt,
    })

    const updatedSession = await getUserSession()
    setUser(updatedSession || null)
  }, [])

  // Silent re-authentication using discoverable credentials (passkey)
  const silentReauth = useCallback(async (): Promise<boolean> => {
    try {
      console.log("[v0] Attempting silent re-auth with passkey...")

      // Get authentication options from server (GET request, not POST)
      const optionsRes = await fetch("/api/auth/login/passkey", {
        method: "GET",
        cache: "no-store",
      })

      if (!optionsRes.ok) {
        console.log("[v0] Silent re-auth: no passkey options available")
        return false
      }

      const options = await optionsRes.json()
      const rpId = window.location.hostname

      // Trigger WebAuthn - this will use resident/discoverable credentials
      const credential = await startAuthentication({
        optionsJSON: {
          challenge: options.challenge,
          rpId: rpId,
          timeout: options.timeout,
          userVerification: options.userVerification,
        },
      })

      // Verify with server - match the expected payload format
      const verifyRes = await fetch("/api/auth/login/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: {
            id: credential.id,
            rawId: credential.rawId,
            response: credential.response,
            type: credential.type,
          },
          challenge: options.challenge,
          deviceId: "silent-reauth",
        }),
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
        expiresAt: typeof session.expiresAt === "number" ? session.expiresAt : new Date(session.expiresAt).getTime(),
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

          // Proactively cache pages in background for offline access
          if ("serviceWorker" in navigator) {
            navigator.serviceWorker.ready.then((registration) => {
              if (registration.active) {
                registration.active.postMessage({
                  type: "CACHE_PAGES",
                  pages: ["/", "/logbook", "/new-flight", "/aircraft", "/airports", "/crew"],
                })
              }
            })
          }
          return
        }

        // No local session found — route protection effect will handle redirect
        console.log("[v0] No valid session found")
      } catch (error) {
        console.error("[v0] Auth check error:", error)
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentional: run once on mount; authCheckDone.current guards against double execution

  // Protect routes
  useEffect(() => {
    if (!isLoading && !user && pathname !== "/login") {
      router.push("/login")
    }
  }, [user, isLoading, pathname])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        silentReauth,
        updateCallsign,
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
