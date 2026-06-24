"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useRouter, usePathname } from "next/navigation"
import { getUserSession, saveUserSession, clearAllUserData, type UserSession } from "@/lib/db"
import { resetDBState } from "@/hooks/data/use-db"
import { startAuthentication } from "@simplewebauthn/browser"
import { AppStatusOverlay } from "@/components/app-status-overlay"

interface AuthContextType {
  user: UserSession | null
  isLoading: boolean
  isAuthenticated: boolean
  /**
   * True when a logged-in user's server session is no longer valid (expired or
   * revoked from another device) but the local mirror still exists. UI can react
   * to this to surface a "re-authenticate" state instead of showing stale data.
   */
  sessionExpired: boolean
  login: (session: Omit<UserSession, "id" | "createdAt">) => Promise<void>
  logout: () => Promise<void>
  silentReauth: () => Promise<boolean>
  /**
   * Ensure the server session is valid before a privileged action (e.g. a manual
   * resync). Returns true if already valid or successfully re-authenticated via
   * the custom passkey flow; otherwise routes to the login flow and returns false.
   */
  ensureValidSession: () => Promise<boolean>
  updateCallsign: (newCallsign: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const authCheckDone = useRef(false)

  const login = useCallback(async (session: Omit<UserSession, "id" | "createdAt">) => {
    await saveUserSession(session)
    const savedSession = await getUserSession()
    setUser(savedSession || null)
    // A fresh login always clears any stale "expired" state.
    setSessionExpired(false)

    // After successful login, trigger proactive caching of app pages
    if (savedSession && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.active) {
          registration.active.postMessage({
            type: "CACHE_PAGES",
            pages: ["/", "/logbook", "/aircraft", "/airports", "/crew"],
          })
          console.log("[Auth] Triggered proactive page caching after login")
        }
      })
    }
  }, [])

  const logout = useCallback(async () => {
    // Show immediate feedback — the pre-logout sync + session-delete below are
    // async and otherwise leave the UI looking frozen / the tap ignored.
    setIsLoggingOut(true)

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

    // Set user null FIRST — triggers route protection redirect to /login,
    // which unmounts KeepAlivePages before we clear the database.
    // This prevents race conditions where mounted pages query a cleared DB.
    setUser(null)
    router.push("/login")

    // Clear local data after navigation has started (KeepAlivePages unmounting)
    try {
      await clearAllUserData()
    } catch (error) {
      console.error("[Auth] Failed to clear local data:", error)
    }

    // Reset DB initialization state so re-login re-initializes properly
    resetDBState()
    setIsLoggingOut(false)
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
      setSessionExpired(false)

      console.log("[v0] Silent re-auth successful for:", userData.callsign)
      return true
    } catch (error) {
      // WebAuthn errors are expected if user cancels or no credential available
      console.log("[v0] Silent re-auth failed:", error)
      return false
    }
  }, [])

  // The reauth handler the sync engine calls on a 401 (background DB access or a
  // manual resync). It runs the custom passkey flow; if that can't recover the
  // session, it flips the reactive `sessionExpired` flag so the UI updates and
  // the route guard sends the user through the custom login flow.
  const handleSyncReauth = useCallback(async (): Promise<boolean> => {
    const ok = await silentReauth()
    if (!ok) {
      console.warn("[Auth] reauth failed during sync - marking session expired")
      setSessionExpired(true)
    }
    return ok
  }, [silentReauth])

  // Register reauth with the sync engine so a 401 mid-sync refreshes the session
  // once and retries, instead of silently failing the sync.
  useEffect(() => {
    let active = true
    import("@/lib/sync").then(({ syncService }) => {
      if (active) syncService.setReauthHandler(handleSyncReauth)
    })
    return () => {
      active = false
      import("@/lib/sync").then(({ syncService }) => syncService.setReauthHandler(null))
    }
  }, [handleSyncReauth])

  // Global session monitor: keep React auth state in sync with the *actual*
  // server session so a session expired/revoked elsewhere is reflected without a
  // manual browser refresh. Validation never triggers WebAuthn on its own
  // (browsers block un-gestured ceremonies); it only flips `sessionExpired`, and
  // the route guard below routes to the custom login flow for a user gesture.
  useEffect(() => {
    if (!user) return

    let cancelled = false

    const checkSession = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      if (typeof navigator !== "undefined" && !navigator.onLine) return
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" })
        const data = await res.json().catch(() => ({ authenticated: false }))
        if (cancelled) return
        // Use a functional update so we don't need `sessionExpired` as a dep.
        setSessionExpired((prev) => {
          const expired = !data.authenticated
          if (expired !== prev) {
            console.log(`[Auth] session monitor: ${expired ? "expired" : "active"}`)
          }
          return expired
        })
      } catch {
        // Network error — treat as inconclusive (offline-first), don't flip state.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") checkSession()
    }
    const onUnauthorized = () => checkSession()

    // Re-validate on focus/visibility/network-online, on an explicit
    // unauthorized signal, and on a slow background interval as a backstop.
    window.addEventListener("focus", checkSession)
    window.addEventListener("online", checkSession)
    window.addEventListener("auth:unauthorized", onUnauthorized)
    document.addEventListener("visibilitychange", onVisible)
    const interval = window.setInterval(checkSession, 60_000)

    // Initial check shortly after mount/login.
    checkSession()

    return () => {
      cancelled = true
      window.removeEventListener("focus", checkSession)
      window.removeEventListener("online", checkSession)
      window.removeEventListener("auth:unauthorized", onUnauthorized)
      document.removeEventListener("visibilitychange", onVisible)
      window.clearInterval(interval)
    }
  }, [user])

  // Ensure a valid server session before a privileged, user-gestured action such
  // as a manual resync. Because this runs inside a user gesture, WebAuthn is
  // allowed, so we can attempt the custom silent-reauth flow inline; if it fails
  // we mark the session expired (the route guard then opens the login flow).
  const ensureValidSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" })
      const data = await res.json().catch(() => ({ authenticated: false }))
      if (data.authenticated) {
        setSessionExpired(false)
        return true
      }
    } catch {
      // Inconclusive (likely offline) — let the caller proceed; the sync engine's
      // own 401 handling will catch a genuinely dead session.
      return true
    }

    // Session is dead — run the custom passkey reauth flow (user-gestured here).
    const ok = await silentReauth()
    if (!ok) setSessionExpired(true)
    return ok
  }, [silentReauth])

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
                  pages: ["/", "/logbook", "/aircraft", "/airports", "/crew"],
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
  }, []) // intentional: run once on mount; authCheckDone.current guards against double execution

  // Protect routes. A logged-out user OR a logged-in user whose server session
  // died (and couldn't be silently recovered) is routed to the custom login
  // flow. We keep local data intact — re-authenticating restores access and the
  // sync engine continues from where it left off.
  useEffect(() => {
    if (isLoading) return
    if ((!user || sessionExpired) && pathname !== "/login") {
      router.push("/login")
    }
  }, [user, sessionExpired, isLoading, pathname, router])

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user && !sessionExpired,
      sessionExpired,
      login,
      logout,
      silentReauth,
      ensureValidSession,
      updateCallsign,
    }),
    [user, isLoading, sessionExpired, login, logout, silentReauth, ensureValidSession, updateCallsign]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      {isLoggingOut && (
        <AppStatusOverlay title="Signing out…" description="Saving your changes" />
      )}
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
