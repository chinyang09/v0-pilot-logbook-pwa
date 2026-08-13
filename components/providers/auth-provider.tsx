"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useRouter, usePathname } from "next/navigation"
import { getUserSession, saveUserSession, clearAllUserData, type UserSession } from "@/lib/db"
import { resetDBState } from "@/hooks/data/use-db"
import { startAuthentication } from "@simplewebauthn/browser"
import { getOrCreateDeviceId } from "@/lib/utils/device"
import { classifySessionResponse, type SessionVerdict } from "@/lib/auth/shared/session-verdict"
import { AppStatusOverlay } from "@/components/app-status-overlay"

/**
 * Ask the server whether the session cookie is still good.
 *
 * Returns THREE states, not two. `unknown` means the server did not answer —
 * offline, a captive portal, a 5xx, a cold-start timeout, or the service
 * worker's synthetic offline stub — and must never end a session. See
 * `lib/auth/shared/session-verdict.ts` for why that distinction is the whole
 * reason an offline app stopped kicking itself back to /login.
 */
async function probeSession(): Promise<{ verdict: SessionVerdict; expiresAt?: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { verdict: "unknown" }

  let res: Response
  try {
    res = await fetch("/api/auth/session", { cache: "no-store" })
  } catch {
    // Genuine network failure — inconclusive, never a logout.
    return { verdict: "unknown" }
  }

  // `navigator.onLine` above is not enough on its own: it reports true on a
  // captive portal or an attached-but-dead cell/aircraft network, which is
  // precisely where this app is used.
  const body = await res.json().catch(() => undefined)

  const verdict = classifySessionResponse({
    ok: res.ok,
    swOffline: res.headers.get("X-SW-Offline"),
    body,
  })

  const reported = (body as { expiresAt?: unknown } | undefined)?.expiresAt
  return {
    verdict,
    expiresAt: typeof reported === "number" ? reported : undefined,
  }
}

/**
 * Keep the IndexedDB session mirror's expiry in step with the server's.
 *
 * The server slides a session's expiry forward on access; the mirror was only
 * written at login, so on a device in daily use it aged out at exactly 30 days
 * while the server session was still perfectly good. `getUserSession()` DELETES
 * an expired mirror, so the next cold start found nothing and sent the user to
 * the login screen — and the sync engine lost its bearer token at the same
 * moment. Only ever extends; it never shortens a live mirror.
 */
async function refreshLocalSessionExpiry(expiresAt: number | undefined): Promise<void> {
  if (!expiresAt) return
  try {
    const local = await getUserSession()
    if (!local || local.expiresAt >= expiresAt) return
    await saveUserSession({
      userId: local.userId,
      callsign: local.callsign,
      expiresAt,
    })
    console.log("[Auth] local session mirror extended to match server")
  } catch (error) {
    console.error("[Auth] failed to extend local session mirror:", error)
  }
}

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
      expiresAt: currentSession.expiresAt,
    })

    const updatedSession = await getUserSession()
    setUser(updatedSession || null)
  }, [])

  // Silent re-authentication using discoverable credentials (passkey)
  const silentReauth = useCallback(async (): Promise<boolean> => {
    // A WebAuthn ceremony with no network cannot succeed — the challenge has to
    // come from the server and the assertion has to go back to it. Attempting it
    // offline only throws up a biometric prompt that is guaranteed to fail, and
    // the failure then reads as "session expired".
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      console.log("[Auth] skipping silent re-auth - offline")
      return false
    }

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
          // The REAL device id, not a literal. `issueSession` upserts the
          // session row on {userId, deviceId}, so a constant like
          // "silent-reauth" made every device on the account share ONE row:
          // a silent reauth on the iPad rewrote that row's token, the phone's
          // copy no longer matched any session, and the phone got a 401 and
          // reauthed — rewriting it back. Two devices could sit there
          // invalidating each other indefinitely, which is a second, entirely
          // independent source of "it logged me out on its own".
          deviceId: getOrCreateDeviceId(),
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
      // Only an ONLINE failure is evidence the session is really gone. Offline,
      // the reauth could not even be attempted, so treating it as expired would
      // bounce a working offline app to the login screen.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        console.warn("[Auth] reauth skipped during sync - offline, session left intact")
        return false
      }
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
    // Returning to the tab fires BOTH `focus` and `visibilitychange`; without a
    // guard every wake did two identical fetches.
    //
    // The window is 60s rather than 1s because a *confirmed-alive* session is
    // the overwhelmingly common case and each probe costs a full round trip
    // plus an indexed MongoDB lookup — on a phone, app-switching back and forth
    // paid that on every single switch. A session revoked from another device
    // is still caught within a minute by the next focus, immediately by the
    // sync engine's 401 (which forces a check through `auth:unauthorized`), and
    // by the interval backstop. Nothing that *acts* on the session relies on
    // this poll for its safety: every API route validates server-side on every
    // request, so a stale "alive" belief here grants no access.
    const PROOF_TTL_MS = 60_000
    let lastProof = 0

    const checkSession = async (opts?: { force?: boolean }) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      if (typeof navigator !== "undefined" && !navigator.onLine) return
      const now = Date.now()
      if (!opts?.force && now - lastProof < PROOF_TTL_MS) return
      lastProof = now

      const { verdict, expiresAt } = await probeSession()
      if (cancelled) return

      // `unknown` is the offline / server-hiccup case: leave the current state
      // exactly as it is. Flipping to expired here is what stranded the user on
      // /login with no way back until the app was killed and relaunched.
      // It is also not proof of anything, so it must not extend the freshness
      // window — otherwise one offline probe would suppress checks for a minute.
      if (verdict === "unknown") {
        lastProof = 0
        return
      }

      if (verdict === "valid") void refreshLocalSessionExpiry(expiresAt)

      // Use a functional update so we don't need `sessionExpired` as a dep.
      setSessionExpired((prev) => {
        const expired = verdict === "invalid"
        if (expired !== prev) {
          console.log(`[Auth] session monitor: ${expired ? "expired" : "active"}`)
        }
        return expired
      })
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") checkSession()
    }
    // A 401 signal must never be de-duped away — it is the one input that
    // carries real evidence the session changed.
    const onUnauthorized = () => checkSession({ force: true })
    // Coming back online is the moment a previously-inconclusive answer can
    // finally be resolved (and a stale `sessionExpired` cleared), so force it.
    const onOnline = () => checkSession({ force: true })

    // Re-validate on focus/visibility/network-online, on an explicit
    // unauthorized signal, and on a slow background interval as a backstop.
    // The interval is deliberately long (4 min) — the event triggers cover
    // every responsive case, so the timer only exists for a session revoked
    // while the tab sits open and untouched.
    const onFocus = () => checkSession()
    window.addEventListener("focus", onFocus)
    window.addEventListener("online", onOnline)
    window.addEventListener("auth:unauthorized", onUnauthorized)
    document.addEventListener("visibilitychange", onVisible)
    const interval = window.setInterval(() => checkSession({ force: true }), 240_000)

    // Initial check shortly after mount/login.
    checkSession({ force: true })

    return () => {
      cancelled = true
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("online", onOnline)
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
    const { verdict, expiresAt } = await probeSession()

    if (verdict === "valid") {
      await refreshLocalSessionExpiry(expiresAt)
      setSessionExpired(false)
      return true
    }

    // Inconclusive (offline, captive portal, 5xx) — let the caller proceed; the
    // sync engine's own 401 handling catches a genuinely dead session once the
    // network is back. Crucially we must NOT fall through to `silentReauth()`
    // here: that fires a WebAuthn ceremony which cannot possibly succeed with no
    // network, and its failure used to mark the session expired.
    if (verdict === "unknown") return true

    // Authoritatively dead — run the custom passkey reauth flow (user-gestured here).
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
