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
  Share,
  MoreVertical,
  LogOut,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { SwipeableCard } from "@/components/swipeable-card"
import { HoldToConfirmButton } from "@/components/ui/hold-to-confirm-button"
import { base64URLEncode, base64URLDecode } from "@/lib/auth/server/webauthn"
import { parseUserAgent } from "@/lib/utils/user-agent"

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

  // Inline callsign edit (accordion inside the Profile card)
  const [isEditingCallsign, setIsEditingCallsign] = useState(false)
  const [newCallsign, setNewCallsign] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [callsignError, setCallsignError] = useState("")
  const [callsignSuccess, setCallsignSuccess] = useState("")
  const [isChangingCallsign, setIsChangingCallsign] = useState(false)

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
  const [addPasskeyNotice, setAddPasskeyNotice] = useState("")

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
  // revoked elsewhere is reflected without a manual browser refresh.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        fetchProfile()
        fetchSessions()
      }
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [fetchProfile, fetchSessions])

  const openCallsignEditor = () => {
    setCallsignError("")
    setCallsignSuccess("")
    setNewCallsign("")
    setTotpCode("")
    setIsEditingCallsign((v) => !v)
  }

  const handleChangeCallsign = async () => {
    setCallsignError("")
    setCallsignSuccess("")
    setIsChangingCallsign(true)

    try {
      const res = await fetch("/api/account/callsign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newCallsign: newCallsign.trim(), totpCode }),
      })

      const data = await res.json()

      if (!res.ok) {
        setCallsignError(data.error || "Failed to change callsign")
        return
      }

      await updateCallsign(data.callsign)
      setCallsignSuccess("Callsign updated")
      setNewCallsign("")
      setTotpCode("")
      fetchProfile()
      // Collapse the editor shortly after success.
      setTimeout(() => setIsEditingCallsign(false), 900)
    } catch {
      setCallsignError("Network error. Please try again.")
    } finally {
      setIsChangingCallsign(false)
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
        // Revoking the current device's session is now allowed — when it's the
        // one backing this request, finish by clearing local data + signing out.
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
      // Drop every server session row, then run the local logout (clears the
      // cookie + IndexedDB and redirects to the login flow).
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

      if (res.ok) {
        fetchProfile()
      }
    } catch (error) {
      console.error("[Account] Failed to remove passkey:", error)
    } finally {
      setRemovingPasskey(null)
    }
  }

  const handleAddPasskey = async () => {
    setAddPasskeyError("")
    setAddPasskeyNotice("")
    setIsAddingPasskey(true)
    try {
      // 1. Get registration options
      const optionsRes = await fetch("/api/auth/register/add-passkey", { cache: "no-store" })
      if (!optionsRes.ok) {
        const err = await optionsRes.json().catch(() => ({}))
        throw new Error(err.error || "Failed to start passkey setup")
      }
      const options = await optionsRes.json()

      // 2. Run the WebAuthn create ceremony on this device
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
            // Pass transports only when valid — a null/garbage value makes
            // create() throw "value is not a sequence".
            if (Array.isArray(c.transports) && c.transports.every((t) => typeof t === "string")) {
              desc.transports = c.transports as AuthenticatorTransport[]
            }
            return desc
          }),
        },
      })) as PublicKeyCredential | null

      if (!credential) throw new Error("Passkey setup cancelled")
      const response = credential.response as AuthenticatorAttestationResponse

      // 3. Verify + persist server-side
      const saveRes = await fetch("/api/auth/register/add-passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge: options.challenge,
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
      // This device already holds a passkey for the account. The authenticator
      // (via excludeCredentials) refuses to create a duplicate and throws
      // InvalidStateError. That's not a failure — there's simply nothing to do,
      // so notify politely and exit the flow cleanly.
      if (err instanceof Error && err.name === "InvalidStateError") {
        setAddPasskeyNotice("A passkey for this device is already registered and active.")
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
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
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

  return (
    <PageContainer>
      <div className="px-4 pt-4 pb-safe space-y-4 max-w-2xl mx-auto w-full">

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
                  <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="new-callsign" className="text-xs">New callsign</Label>
                      <Input
                        id="new-callsign"
                        value={newCallsign}
                        onChange={(e) => setNewCallsign(e.target.value)}
                        placeholder="Enter new callsign"
                        autoComplete="off"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Authenticator code</Label>
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
                    </div>

                    {callsignError && <p className="text-sm text-destructive">{callsignError}</p>}
                    {callsignSuccess && (
                      <p className="text-sm text-green-600 dark:text-green-400">{callsignSuccess}</p>
                    )}

                    <Button
                      size="sm"
                      onClick={handleChangeCallsign}
                      disabled={!newCallsign.trim() || totpCode.length !== 6 || isChangingCallsign}
                    >
                      {isChangingCallsign && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Update callsign
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">User ID</span>
              <span className="text-sm font-mono text-muted-foreground truncate max-w-[55%] text-right">
                {profile?.userId || user?.userId}
              </span>
            </div>
            {profile?.createdAt && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Member since</span>
                <span className="text-sm">{formatDate(profile.createdAt)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">2FA (TOTP)</span>
              {isLoading && !profile ? (
                <Skeleton className="h-5 w-16 rounded-full" />
              ) : (
                <Badge variant={profile?.totpEnabled ? "default" : "secondary"}>
                  {profile?.totpEnabled ? "Enabled" : "Disabled"}
                </Badge>
              )}
            </div>
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
              return (
                <SwipeableCard
                  key={pk.credentialId}
                  variant="row"
                  separated
                  actions={[
                    {
                      icon: <Trash2 className="h-5 w-5" />,
                      label: "Delete",
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
                      <p className="text-sm font-medium truncate">{pk.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pk.deviceType} {pk.backedUp && "· Synced"} · Added {formatDate(pk.createdAt)}
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
              {addPasskeyNotice && (
                <p className="text-sm text-muted-foreground flex items-start gap-1.5">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
                  {addPasskeyNotice}
                </p>
              )}

              <Button variant="outline" size="sm" onClick={handleAddPasskey} disabled={isAddingPasskey}>
                {isAddingPasskey ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Add Passkey
              </Button>
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
                      label: session.isCurrent ? "Sign out" : "Revoke",
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
                        {session.recoveryLogin && (
                          <Badge variant="outline" className="text-xs shrink-0">Recovery</Badge>
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

        {/* Install App */}
        {!pwaInstalled && (
          <Card className="py-4 gap-3">
            <CardHeader className="px-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Download className="h-4 w-4" />
                Install App
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 space-y-3">
              <Button size="sm" onClick={handlePwaInstall}>
                <Download className="h-4 w-4 mr-2" />
                {pwaPlatform === "ios" ? "How to Install" : "Install App"}
              </Button>
              {showPwaInstructions && pwaPlatform === "ios" && (
                <div className="space-y-2.5 text-sm pt-2 border-t border-border">
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
                </div>
              )}
              {showPwaInstructions && pwaPlatform === "android" && (
                <div className="space-y-2.5 text-sm pt-2 border-t border-border">
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
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}
