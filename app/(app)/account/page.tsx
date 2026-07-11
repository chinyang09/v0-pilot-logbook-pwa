"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/components/providers/auth-provider"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import {
  KeyRound,
  Monitor,
  Smartphone,
  Tablet,
  Trash2,
  Plus,
  Loader2,
  Pencil,
  X,
  Download,
  CheckCircle2,
  Check,
  Copy,
  Share,
  MoreVertical,
  LogOut,
  Fingerprint,
  QrCode,
  ChevronDown,
} from "lucide-react"
import dynamic from "next/dynamic"
import { motion, AnimatePresence } from "framer-motion"

// The QR code renders only after a passkey step-up reveal — load it on demand
// instead of shipping qrcode.react with the page bundle.
const QRCodeSVG = dynamic(() => import("qrcode.react").then((m) => m.QRCodeSVG), {
  ssr: false,
  loading: () => <Skeleton className="h-[150px] w-[150px] rounded" />,
})
import { SwipeableCard } from "@/components/swipeable-card"
import { HoldToConfirmButton } from "@/components/ui/hold-to-confirm-button"
import { base64URLEncode, base64URLDecode } from "@/lib/auth/server/webauthn"
import { parseUserAgent } from "@/lib/utils/user-agent"
import { getOrCreateDeviceId } from "@/lib/utils/device"
import { cn } from "@/lib/utils"

interface ProfileData {
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

interface SessionData {
  id: string
  isCurrent: boolean
  createdAt: string
  lastAccessedAt: string
  expiresAt: string
  recoveryLogin: boolean
  userAgent: string | null
}

interface StepUpAssertion {
  challenge: string
  credential: {
    id: string
    response: { authenticatorData: string; clientDataJSON: string; signature: string }
  }
}

/** Pick an icon that roughly matches the device class parsed from the UA. */
function deviceIconFor(os: string) {
  if (os === "iPhone" || os === "Android") return Smartphone
  if (os === "iPad") return Tablet
  return Monitor
}

export default function AccountPage() {
  const { user, logout, updateCallsign } = useAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [sessions, setSessions] = useState<SessionData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // Read the per-browser device id lazily (localStorage). Only used in
  // client-fetched comparisons, so the SSR/CSR null→id difference is invisible.
  const [myDeviceId] = useState<string | null>(() =>
    typeof window !== "undefined" ? getOrCreateDeviceId() : null,
  )

  // Inline callsign edit (accordion inside the Profile card)
  const [isEditingCallsign, setIsEditingCallsign] = useState(false)
  const [newCallsign, setNewCallsign] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [callsignError, setCallsignError] = useState("")
  const [callsignSuccess, setCallsignSuccess] = useState("")
  const [isChangingCallsign, setIsChangingCallsign] = useState(false)
  const [isPasskeyVerifying, setIsPasskeyVerifying] = useState(false)

  // TOTP re-add (reveal seed/QR) — gated by passkey step-up
  const [totpReveal, setTotpReveal] = useState<{ secret: string; uri: string } | null>(null)
  const [isRevealing, setIsRevealing] = useState(false)
  const [revealError, setRevealError] = useState("")

  // Copy-to-clipboard feedback (keyed so each button flips independently)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Clear stale keep-alive page actions
  useRegisterMainActions(null, true)

  // Session revoke loading
  const [revokingToken, setRevokingToken] = useState<string | null>(null)
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false)

  // Passkey removal loading
  const [removingPasskey, setRemovingPasskey] = useState<string | null>(null)

  // Add-passkey state
  const [isAddingPasskey, setIsAddingPasskey] = useState(false)
  const [addPasskeyError, setAddPasskeyError] = useState("")
  // Set when this device is detected to already hold a passkey that predates the
  // deviceId tag (legacy) — the authenticator rejects a duplicate with
  // InvalidStateError, which we treat as "already registered here".
  const [devicePasskeyDetected, setDevicePasskeyDetected] = useState(false)

  // PWA install state
  const [pwaInstalled, setPwaInstalled] = useState(false)
  const [pwaPlatform, setPwaPlatform] = useState<"ios" | "android" | "desktop" | null>(null)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<Event | null>(null)
  const [showPwaInstructions, setShowPwaInstructions] = useState(false)

  useEffect(() => {
    // Check if already running as PWA
    const standalone = typeof window !== "undefined" && (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    )
    if (standalone) {
      setPwaInstalled(true)
      return
    }

    // Detect platform
    const ua = navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    if (isIOS) {
      setPwaPlatform("ios")
      return
    }

    const isMobile = /Android|webOS/i.test(ua)
    setPwaPlatform(isMobile ? "android" : "desktop")

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredInstallPrompt(e)
    }
    window.addEventListener("beforeinstallprompt", handler)
    window.addEventListener("appinstalled", () => setPwaInstalled(true))
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  const handlePwaInstall = useCallback(async () => {
    if (pwaPlatform === "ios") {
      setShowPwaInstructions((v) => !v)
      return
    }
    if (!deferredInstallPrompt) {
      setShowPwaInstructions((v) => !v)
      return
    }
    ;(deferredInstallPrompt as Event & { prompt: () => Promise<void> }).prompt()
  }, [deferredInstallPrompt, pwaPlatform])

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/account/profile", { cache: "no-store" })
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
      }
    } catch (error) {
      console.error("[Account] Failed to fetch profile:", error)
    }
  }, [])

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/account/sessions", { cache: "no-store" })
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions)
      }
    } catch (error) {
      console.error("[Account] Failed to fetch sessions:", error)
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchProfile(), fetchSessions()]).finally(() => setIsLoading(false))
  }, [fetchProfile, fetchSessions])

  // Keep profile + sessions fresh when returning to the tab, so a session
  // revoked elsewhere is reflected without a manual browser refresh. Returning
  // fires BOTH `focus` and `visibilitychange`, so a 1s guard stops each wake
  // from double-fetching.
  useEffect(() => {
    let lastRefresh = 0
    const refresh = () => {
      if (document.visibilityState !== "visible") return
      const now = Date.now()
      if (now - lastRefresh < 1000) return
      lastRefresh = now
      fetchProfile()
      fetchSessions()
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [fetchProfile, fetchSessions])

  const copyToClipboard = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    } catch (e) {
      console.error("[Account] copy failed:", e)
    }
  }, [])

  const openCallsignEditor = () => {
    setCallsignError("")
    setCallsignSuccess("")
    setRevealError("")
    setNewCallsign("")
    setTotpCode("")
    setTotpReveal(null)
    setIsEditingCallsign((v) => !v)
  }

  // Run a passkey "step-up" ceremony and return the assertion (or null if the
  // user cancelled). Throws for setup/availability errors so callers can message.
  const stepUpPasskey = useCallback(async (): Promise<StepUpAssertion | null> => {
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
  }, [])

  const applyCallsignResult = async (res: Response) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setCallsignError(data.error || "Failed to change callsign")
      return false
    }
    await updateCallsign(data.callsign)
    setCallsignSuccess("Callsign updated")
    setNewCallsign("")
    setTotpCode("")
    fetchProfile()
    setTimeout(() => setIsEditingCallsign(false), 900)
    return true
  }

  const handleChangeCallsignTotp = async () => {
    setCallsignError("")
    setCallsignSuccess("")
    setIsChangingCallsign(true)
    try {
      const res = await fetch("/api/account/callsign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newCallsign: newCallsign.trim(), totpCode }),
      })
      await applyCallsignResult(res)
    } catch {
      setCallsignError("Network error. Please try again.")
    } finally {
      setIsChangingCallsign(false)
    }
  }

  const handleChangeCallsignPasskey = async () => {
    setCallsignError("")
    setCallsignSuccess("")
    setIsPasskeyVerifying(true)
    try {
      const assertion = await stepUpPasskey()
      if (!assertion) return // user cancelled
      const res = await fetch("/api/account/callsign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newCallsign: newCallsign.trim(), assertion }),
      })
      await applyCallsignResult(res)
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setCallsignError("Passkey verification was cancelled.")
      } else {
        setCallsignError(err instanceof Error ? err.message : "Passkey verification failed")
      }
    } finally {
      setIsPasskeyVerifying(false)
    }
  }

  const handleRevealTotp = async () => {
    setRevealError("")
    setIsRevealing(true)
    try {
      const assertion = await stepUpPasskey()
      if (!assertion) return
      const res = await fetch("/api/account/totp/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assertion }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not reveal authenticator code")
      setTotpReveal({ secret: data.secret, uri: data.uri })
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setRevealError("Passkey verification was cancelled.")
      } else {
        setRevealError(err instanceof Error ? err.message : "Could not reveal authenticator code")
      }
    } finally {
      setIsRevealing(false)
    }
  }

  const handleRevokeSession = async (session: SessionData) => {
    setRevokingToken(session.id)
    try {
      const res = await fetch("/api/account/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      })

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        // Revoking the current device's session is allowed — when it's the one
        // backing this request, finish by clearing local data + signing out.
        if (data.loggedOutCurrent || session.isCurrent) {
          await logout()
          return
        }
        setSessions((prev) => prev.filter((s) => s.id !== session.id))
      }
    } catch (error) {
      console.error("[Account] Failed to revoke session:", error)
    } finally {
      setRevokingToken(null)
    }
  }

  const handleLogoutAll = async () => {
    setIsLoggingOutAll(true)
    try {
      await fetch("/api/account/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      }).catch(() => {})
      await logout()
    } finally {
      setIsLoggingOutAll(false)
    }
  }

  const handleRemovePasskey = async (credentialId: string) => {
    setRemovingPasskey(credentialId)
    try {
      const res = await fetch("/api/account/passkeys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId }),
      })
      if (res.ok) fetchProfile()
    } catch (error) {
      console.error("[Account] Failed to remove passkey:", error)
    } finally {
      setRemovingPasskey(null)
    }
  }

  const handleAddPasskey = async () => {
    setAddPasskeyError("")
    setIsAddingPasskey(true)
    try {
      const optionsRes = await fetch("/api/auth/register/add-passkey", { cache: "no-store" })
      if (!optionsRes.ok) {
        const err = await optionsRes.json().catch(() => ({}))
        throw new Error(err.error || "Failed to start passkey setup")
      }
      const options = await optionsRes.json()

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: base64URLDecode(options.challenge),
          rp: { name: options.rp?.name || "OOOI", id: window.location.hostname },
          user: {
            id: base64URLDecode(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName || options.user.name,
          },
          pubKeyCredParams: options.pubKeyCredParams || [
            { alg: -7, type: "public-key" },
            { alg: -257, type: "public-key" },
          ],
          timeout: options.timeout || 60000,
          attestation: "none",
          authenticatorSelection: options.authenticatorSelection || {
            residentKey: "required",
            userVerification: "required",
          },
          excludeCredentials: (options.excludeCredentials || []).map((c: { id: string; transports?: unknown }) => {
            const desc: PublicKeyCredentialDescriptor = { id: base64URLDecode(c.id), type: "public-key" }
            if (Array.isArray(c.transports) && c.transports.every((t) => typeof t === "string")) {
              desc.transports = c.transports as AuthenticatorTransport[]
            }
            return desc
          }),
        },
      })) as PublicKeyCredential | null

      if (!credential) throw new Error("Passkey setup cancelled")
      const response = credential.response as AuthenticatorAttestationResponse

      const saveRes = await fetch("/api/auth/register/add-passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge: options.challenge,
          deviceId: getOrCreateDeviceId(),
          credential: {
            id: credential.id,
            rawId: base64URLEncode(credential.rawId),
            response: {
              clientDataJSON: base64URLEncode(response.clientDataJSON),
              attestationObject: base64URLEncode(response.attestationObject),
              publicKey: response.getPublicKey ? base64URLEncode(response.getPublicKey()!) : "",
              transports: response.getTransports?.() || [],
            },
            type: credential.type,
          },
        }),
      })

      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}))
        throw new Error(err.error || "Failed to save passkey")
      }

      await fetchProfile()
    } catch (err) {
      // Shouldn't normally happen now that the UI hides "Add" once this device is
      // registered, but keep it as a safety net: a duplicate on the device throws
      // InvalidStateError — treat as a no-op with a gentle note, not an error.
      if (err instanceof Error && err.name === "InvalidStateError") {
        setAddPasskeyError("")
        setDevicePasskeyDetected(true)
        await fetchProfile()
      } else if (err instanceof Error && err.name === "NotAllowedError") {
        setAddPasskeyError("Passkey setup was cancelled.")
      } else {
        setAddPasskeyError(err instanceof Error ? err.message : "Failed to add passkey")
      }
    } finally {
      setIsAddingPasskey(false)
    }
  }

  const formatDate = (dateInput: string | number) => {
    const date = new Date(dateInput)
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  }

  const formatRelativeTime = (dateInput: string | number) => {
    const date = new Date(dateInput)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  // Does the *current* browser already hold a passkey for this account? Either a
  // stored deviceId matches, or a previous add attempt proved it (legacy keys).
  const thisDeviceHasPasskey =
    devicePasskeyDetected ||
    (!!myDeviceId && !!profile?.passkeys.some((pk) => pk.deviceId && pk.deviceId === myDeviceId))

  return (
    <PageContainer>
      <div className="px-4 pt-4 space-y-4 max-w-2xl mx-auto w-full">

        {/* Global logout — prominent, at the very top */}
        <HoldToConfirmButton
          label={isLoggingOutAll ? "Logging out…" : "Hold to log out of all devices"}
          icon={isLoggingOutAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          onConfirm={handleLogoutAll}
          disabled={isLoggingOutAll}
          className="w-full"
        />

        {/* Profile */}
        <Card className="py-4 gap-3">
          <CardHeader className="px-4">
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="px-4 space-y-3">
            {/* Callsign row with inline edit */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Callsign</span>
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{profile?.callsign || user?.callsign}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  aria-label={isEditingCallsign ? "Cancel editing callsign" : "Edit callsign"}
                  onClick={openCallsignEditor}
                >
                  {isEditingCallsign ? <X className="h-4 w-4" /> : <Pencil className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {isEditingCallsign && (
                <motion.div
                  key="callsign-editor"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  {/* Styled as a continuation of the card (divider + rows), not a
                      separate inner card. */}
                  <div className="space-y-4 border-t border-border/60 pt-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="new-callsign" className="text-xs text-muted-foreground">New callsign</Label>
                      <Input
                        id="new-callsign"
                        value={newCallsign}
                        onChange={(e) => setNewCallsign(e.target.value)}
                        placeholder="Enter new callsign"
                        autoComplete="off"
                        className="h-9"
                      />
                    </div>

                    {/* Primary: authorize with a passkey (works even if the
                        authenticator was lost). */}
                    <Button
                      className="w-full"
                      size="sm"
                      onClick={handleChangeCallsignPasskey}
                      disabled={!newCallsign.trim() || isPasskeyVerifying || isChangingCallsign}
                    >
                      {isPasskeyVerifying ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Fingerprint className="h-4 w-4 mr-2" />
                      )}
                      Verify with passkey & save
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border/60" />
                      </div>
                      <div className="relative flex justify-center text-[10px] uppercase tracking-wide">
                        <span className="px-2 bg-card text-muted-foreground">or use authenticator code</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <InputOTP maxLength={6} value={totpCode} onChange={setTotpCode}>
                        <InputOTPGroup>
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                          <InputOTPSlot index={3} />
                          <InputOTPSlot index={4} />
                          <InputOTPSlot index={5} />
                        </InputOTPGroup>
                      </InputOTP>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={handleChangeCallsignTotp}
                        disabled={!newCallsign.trim() || totpCode.length !== 6 || isChangingCallsign || isPasskeyVerifying}
                      >
                        {isChangingCallsign && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Save with code
                      </Button>
                    </div>

                    {callsignError && <p className="text-sm text-destructive">{callsignError}</p>}
                    {callsignSuccess && (
                      <p className="text-sm text-status-valid">{callsignSuccess}</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground shrink-0">User ID</span>
              <button
                type="button"
                onClick={() => copyToClipboard(profile?.userId || user?.userId || "", "userId")}
                className="flex items-center gap-1.5 min-w-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Copy User ID"
              >
                <span className="text-sm truncate">{profile?.userId || user?.userId}</span>
                {copiedKey === "userId" ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-status-valid" />
                ) : (
                  <Copy className="h-3.5 w-3.5 shrink-0" />
                )}
              </button>
            </div>
            {/* Always render so the value loading in doesn't shove other rows
                down (no cascade). */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Member since</span>
              {profile?.createdAt ? (
                <span className="text-sm">{formatDate(profile.createdAt)}</span>
              ) : (
                <Skeleton className="h-4 w-24" />
              )}
            </div>
            {/* TOTP is mandatory at sign-up, so an "Enabled" chip is redundant —
                this row is just the re-add affordance. */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Authenticator (2FA)</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={handleRevealTotp}
                disabled={isRevealing}
                aria-label="Re-add authenticator"
              >
                {isRevealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
                <span className="ml-1">Re-add</span>
              </Button>
            </div>

            {revealError && <p className="text-sm text-destructive">{revealError}</p>}

            <AnimatePresence initial={false}>
              {totpReveal && (
                <motion.div
                  key="totp-reveal"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 border-t border-border/60 pt-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        Scan this with your authenticator app to re-add your account, or copy the key manually.
                      </p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground shrink-0"
                        aria-label="Hide authenticator code"
                        onClick={() => setTotpReveal(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex justify-center p-3 bg-white rounded-lg w-fit mx-auto">
                      <QRCodeSVG value={totpReveal.uri} size={150} />
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(totpReveal.secret, "totpSecret")}
                      className="flex items-center justify-center gap-2 w-full text-xs bg-muted px-3 py-2 rounded-md break-all text-muted-foreground hover:bg-muted/70 transition-colors"
                    >
                      {totpReveal.secret}
                      {copiedKey === "totpSecret" ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-status-valid" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 shrink-0" />
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        {/* Passkeys */}
        <Card className="py-4 gap-3">
          <CardHeader className="px-4">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Passkeys
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {isLoading && !profile && (
              <div className="flex items-center gap-3 py-2 px-4">
                <Skeleton className="h-4 w-4 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            )}
            {profile?.passkeys.map((pk) => {
              const canRemove = (profile?.passkeys.length || 0) > 1
              const isThisDevice = !!myDeviceId && pk.deviceId === myDeviceId
              return (
                <SwipeableCard
                  key={pk.credentialId}
                  variant="row"
                  separated
                  actions={[
                    {
                      icon: <Trash2 className="h-5 w-5" />,
                      ariaLabel: "Delete passkey",
                      variant: "destructive",
                      holdToConfirm: true,
                      disabled: !canRemove,
                      onClick: () => handleRemovePasskey(pk.credentialId),
                    },
                  ]}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{pk.name}</p>
                        {isThisDevice && (
                          <Badge variant="secondary" className="text-xs shrink-0">This device</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {pk.backedUp ? "Synced · " : ""}Added {formatDate(pk.createdAt)}
                      </p>
                    </div>
                    {removingPasskey === pk.credentialId && (
                      <Loader2 className="h-4 w-4 animate-spin ml-auto text-muted-foreground" />
                    )}
                  </div>
                </SwipeableCard>
              )
            })}

            <div className="px-4 pt-3 space-y-2">
              {addPasskeyError && <p className="text-sm text-destructive">{addPasskeyError}</p>}

              {/* Smart: only offer to add a passkey when THIS device doesn't have
                  one. Otherwise confirm the device is already secured. */}
              {thisDeviceHasPasskey ? (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-status-valid" />
                  This device already has a passkey.
                </p>
              ) : (
                <Button variant="outline" size="sm" onClick={handleAddPasskey} disabled={isAddingPasskey}>
                  {isAddingPasskey ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Add passkey for this device
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Active Sessions */}
        <Card className="py-4 gap-3">
          <CardHeader className="px-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Active Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {isLoading && sessions.length === 0 && (
              <div className="flex items-center gap-3 py-2 px-4">
                <Skeleton className="h-4 w-4 rounded" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
            )}
            {sessions.map((session) => {
              const { deviceName, os } = parseUserAgent(session.userAgent)
              const DeviceIcon = deviceIconFor(os)
              return (
                <SwipeableCard
                  key={session.id}
                  variant="row"
                  separated
                  actions={[
                    {
                      icon: session.isCurrent ? <LogOut className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />,
                      ariaLabel: session.isCurrent ? "Sign out this device" : "Revoke session",
                      variant: "destructive",
                      holdToConfirm: true,
                      onClick: () => handleRevokeSession(session),
                    },
                  ]}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <DeviceIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{deviceName}</p>
                        {session.isCurrent && (
                          <Badge variant="secondary" className="text-xs shrink-0">This device</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Active {formatRelativeTime(session.lastAccessedAt)} · Since {formatDate(session.createdAt)}
                      </p>
                    </div>
                    {revokingToken === session.id && (
                      <Loader2 className="h-4 w-4 animate-spin ml-auto text-muted-foreground" />
                    )}
                  </div>
                </SwipeableCard>
              )
            })}
            {!isLoading && sessions.length === 0 && (
              <p className="text-sm text-muted-foreground px-4">No active sessions found.</p>
            )}
            <p className="text-xs text-muted-foreground px-4 pt-3">
              Swipe a session to sign that device out.
            </p>
          </CardContent>
        </Card>

        {/* Install App — a single surface: the whole header row is the button,
            and (when there are manual steps to show) it expands them inside the
            same card. iOS / browsers without a native prompt expand steps;
            Android/desktop with a prompt installs directly. */}
        {!pwaInstalled && (() => {
          const willExpand = pwaPlatform === "ios" || !deferredInstallPrompt
          return (
            <div className="rounded-xl border bg-card overflow-hidden">
              <button
                type="button"
                onClick={handlePwaInstall}
                aria-expanded={willExpand ? showPwaInstructions : undefined}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  {willExpand ? "How to install app" : "Install app"}
                </span>
                {willExpand && (
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      showPwaInstructions && "rotate-180",
                    )}
                  />
                )}
              </button>
              <AnimatePresence initial={false}>
                {willExpand && showPwaInstructions && (
                  <motion.div
                    key="pwa-steps"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2.5 text-sm border-t px-4 py-3">
                      {pwaPlatform === "ios" ? (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">1</div>
                            <p className="flex items-center gap-1.5">
                              Tap the <Share className="h-4 w-4 inline text-muted-foreground" /> Share button in Safari
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">2</div>
                            <p>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong></p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">3</div>
                            <p>Tap <strong>&quot;Add&quot;</strong> to confirm</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">1</div>
                            <p className="flex items-center gap-1.5">
                              Tap the <MoreVertical className="h-4 w-4 inline text-muted-foreground" /> menu in your browser
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">2</div>
                            <p>Tap <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home Screen&quot;</strong></p>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })()}
      </div>
    </PageContainer>
  )
}
