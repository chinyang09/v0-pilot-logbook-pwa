"use client"

/**
 * What the account sections share: the profile and the session list (one SWR
 * cache each, so the section list in the main panel and the section open in
 * the detail panel read the same answer), the passkey step-up, and the
 * sign-out guard.
 *
 * These are NETWORK reads, not IndexedDB ones, so the keys are the routes and
 * carry no `idb:` prefix — `refreshAllData` is not meant to touch them. They
 * revalidate on focus, which is what keeps a session revoked on another device
 * from lingering here.
 */

import useSWR from "swr"
import { Monitor, Smartphone, Tablet } from "lucide-react"
import { base64URLEncode, base64URLDecode } from "@/lib/auth/server/webauthn"
import { syncService } from "@/lib/sync"
import { appConfirm } from "@/lib/utils/app-alert"

export interface ProfileData {
  userId: string
  callsign: string
  totpEnabled: boolean
  passkeys: Array<{
    credentialId: string
    name: string
    deviceType: string
    backedUp: boolean
    createdAt: number
    deviceId: string | null
  }>
  sessionCount: number
  createdAt: number
}

export interface SessionData {
  id: string
  isCurrent: boolean
  createdAt: string
  lastAccessedAt: string
  expiresAt: string
  recoveryLogin: boolean
  userAgent: string | null
}

export interface StepUpAssertion {
  challenge: string
  credential: {
    id: string
    response: { authenticatorData: string; clientDataJSON: string; signature: string }
  }
}

const PROFILE_KEY = "/api/account/profile"
const SESSIONS_KEY = "/api/account/sessions"

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return res.json()
}

const OPTIONS = { revalidateOnFocus: true, dedupingInterval: 1000 }
const NO_SESSIONS: SessionData[] = []

export function useAccountProfile() {
  const { data, isLoading, mutate } = useSWR<ProfileData>(PROFILE_KEY, fetchJson, OPTIONS)
  return { profile: data ?? null, isLoading, refresh: mutate }
}

export function useAccountSessions() {
  const { data, isLoading, mutate } = useSWR<{ sessions: SessionData[] }>(SESSIONS_KEY, fetchJson, OPTIONS)
  return { sessions: data?.sessions ?? NO_SESSIONS, isLoading, refresh: mutate }
}

/** Pick an icon that roughly matches the device class parsed from the UA. */
export function deviceIconFor(os: string) {
  if (os === "iPhone" || os === "Android") return Smartphone
  if (os === "iPad") return Tablet
  return Monitor
}

const DATE = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })

export const formatDate = (dateInput: string | number) => DATE.format(new Date(dateInput))

export function formatRelativeTime(dateInput: string | number) {
  const diffMs = Date.now() - new Date(dateInput).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

/**
 * Run a passkey "step-up" ceremony and return the assertion (or null if the
 * user cancelled). Throws for setup/availability errors so callers can message.
 */
export async function stepUpPasskey(): Promise<StepUpAssertion | null> {
  const res = await fetch("/api/account/step-up", { cache: "no-store" })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || "Could not start passkey verification")
  }
  const options = await res.json()
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: base64URLDecode(options.challenge),
      rpId: window.location.hostname,
      timeout: options.timeout,
      userVerification: options.userVerification,
      allowCredentials: (options.allowCredentials || []).map((c: { id: string; transports?: unknown }) => {
        const desc: PublicKeyCredentialDescriptor = { id: base64URLDecode(c.id), type: "public-key" }
        if (Array.isArray(c.transports) && c.transports.every((t) => typeof t === "string")) {
          desc.transports = c.transports as AuthenticatorTransport[]
        }
        return desc
      }),
    },
  })) as PublicKeyCredential | null

  if (!credential) return null
  const r = credential.response as AuthenticatorAssertionResponse
  return {
    challenge: options.challenge,
    credential: {
      id: credential.id,
      response: {
        clientDataJSON: base64URLEncode(r.clientDataJSON),
        authenticatorData: base64URLEncode(r.authenticatorData),
        signature: base64URLEncode(r.signature),
      },
    },
  }
}

/**
 * Signing out wipes this device's local data. Push first — while the session
 * still works — and if anything could not be sent, ask before throwing it
 * away. This is the one place a confirmation earns its keep: the loss has no
 * undo, there is no Recently Deleted for an edit that never reached the
 * server.
 */
export async function confirmUnsyncedLoss(): Promise<boolean> {
  const left = await syncService.flushBeforeSignOut()
  if (left === 0) return true
  return appConfirm({
    title: `${left} unsynced change${left === 1 ? "" : "s"}`,
    message: `${left === 1 ? "It hasn't" : "They haven't"} reached the server and will be lost if you sign out now.`,
    confirmLabel: "Sign out",
    destructive: true,
  })
}
