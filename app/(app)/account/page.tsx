"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/components/providers/auth-provider"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  KeyRound,
  Monitor,
  Trash2,
  LogOut,
  Plus,
  Loader2,
  Shield,
  Download,
  CheckCircle2,
  Share,
  MoreVertical,
} from "lucide-react"
import { base64URLEncode, base64URLDecode } from "@/lib/auth/server/webauthn"

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
}

export default function AccountPage() {
  const { user, logout, updateCallsign } = useAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [sessions, setSessions] = useState<SessionData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Callsign change state
  const [newCallsign, setNewCallsign] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [callsignError, setCallsignError] = useState("")

  // Clear stale keep-alive page actions
  useRegisterMainActions(null, true)
  const [callsignSuccess, setCallsignSuccess] = useState("")
  const [isChangingCallsign, setIsChangingCallsign] = useState(false)

  // Session revoke loading
  const [revokingToken, setRevokingToken] = useState<string | null>(null)

  // Passkey removal loading
  const [removingPasskey, setRemovingPasskey] = useState<string | null>(null)

  // Add-passkey state
  const [isAddingPasskey, setIsAddingPasskey] = useState(false)
  const [addPasskeyError, setAddPasskeyError] = useState("")

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
      const res = await fetch("/api/account/profile")
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
      const res = await fetch("/api/account/sessions")
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
      setCallsignSuccess("Callsign updated successfully")
      setNewCallsign("")
      setTotpCode("")
      fetchProfile()
    } catch {
      setCallsignError("Network error. Please try again.")
    } finally {
      setIsChangingCallsign(false)
    }
  }

  const handleRevokeSession = async (id: string) => {
    setRevokingToken(id)
    try {
      const res = await fetch("/api/account/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      })

      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id))
      }
    } catch (error) {
      console.error("[Account] Failed to revoke session:", error)
    } finally {
      setRevokingToken(null)
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
    setIsAddingPasskey(true)
    try {
      // 1. Get registration options
      const optionsRes = await fetch("/api/auth/passkey/add", { cache: "no-store" })
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
          excludeCredentials: (options.excludeCredentials || []).map((c: { id: string; transports?: AuthenticatorTransport[] }) => ({
            id: base64URLDecode(c.id),
            type: "public-key" as const,
            transports: c.transports,
          })),
        },
      })) as PublicKeyCredential | null

      if (!credential) throw new Error("Passkey setup cancelled")
      const response = credential.response as AuthenticatorAttestationResponse

      // 3. Verify + persist server-side
      const saveRes = await fetch("/api/auth/passkey/add", {
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
      if (err instanceof Error && err.name === "NotAllowedError") {
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

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <div className="px-4 pt-4 pb-safe space-y-6">

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Callsign</span>
            <span className="font-medium">{profile?.callsign || user?.callsign}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">User ID</span>
            <span className="text-sm font-mono text-muted-foreground">{profile?.userId || user?.userId}</span>
          </div>
          {profile?.createdAt && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Member since</span>
              <span className="text-sm">{formatDate(profile.createdAt)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">2FA (TOTP)</span>
            <Badge variant={profile?.totpEnabled ? "default" : "secondary"}>
              {profile?.totpEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Install App Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Download className="h-4 w-4" />
            Install App
          </CardTitle>
          <CardDescription>
            Install OOOI as a standalone app for offline access and a faster experience.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pwaInstalled ? (
            <Button disabled className="opacity-50">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Installed
            </Button>
          ) : (
            <>
              <Button onClick={handlePwaInstall}>
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
            </>
          )}
        </CardContent>
      </Card>

      {/* Change Callsign Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Change Callsign
          </CardTitle>
          <CardDescription>
            Enter your new callsign and verify with your TOTP authenticator code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-callsign">New Callsign</Label>
            <Input
              id="new-callsign"
              value={newCallsign}
              onChange={(e) => setNewCallsign(e.target.value)}
              placeholder="Enter new callsign"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label>TOTP Verification Code</Label>
            <InputOTP
              maxLength={6}
              value={totpCode}
              onChange={setTotpCode}
            >
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

          {callsignError && (
            <p className="text-sm text-destructive">{callsignError}</p>
          )}
          {callsignSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400">{callsignSuccess}</p>
          )}

          <Button
            onClick={handleChangeCallsign}
            disabled={!newCallsign.trim() || totpCode.length !== 6 || isChangingCallsign}
          >
            {isChangingCallsign && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Update Callsign
          </Button>
        </CardContent>
      </Card>

      {/* Passkeys Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Passkeys
          </CardTitle>
          <CardDescription>
            Manage the passkeys registered to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {profile?.passkeys.map((pk) => (
            <div
              key={pk.credentialId}
              className="flex items-center justify-between py-2 border-b border-border last:border-0"
            >
              <div className="flex items-center gap-3">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{pk.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {pk.deviceType} {pk.backedUp && "· Synced"} · Added {formatDate(pk.createdAt)}
                  </p>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={(profile?.passkeys.length || 0) <= 1 || removingPasskey === pk.credentialId}
                  >
                    {removingPasskey === pk.credentialId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove passkey?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove &ldquo;{pk.name}&rdquo; from your account. You won&apos;t be able to sign in with it anymore.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleRemovePasskey(pk.credentialId)}>
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}

          {(profile?.passkeys.length || 0) <= 1 && (
            <p className="text-xs text-muted-foreground">
              Add a passkey on a second device so you can still sign in if you lose this one.
            </p>
          )}

          {addPasskeyError && (
            <p className="text-sm text-destructive">{addPasskeyError}</p>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleAddPasskey}
            disabled={isAddingPasskey}
            className="mt-2"
          >
            {isAddingPasskey ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Add Passkey
          </Button>
        </CardContent>
      </Card>

      {/* Active Sessions Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            Active Sessions
          </CardTitle>
          <CardDescription>
            Devices where you&apos;re currently signed in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between py-2 border-b border-border last:border-0"
            >
              <div className="flex items-center gap-3">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">
                      {session.recoveryLogin ? "Recovery Login" : "Session"}
                    </p>
                    {session.isCurrent && (
                      <Badge variant="secondary" className="text-xs">Current</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Active {formatRelativeTime(session.lastAccessedAt)} · Created {formatDate(session.createdAt)}
                  </p>
                </div>
              </div>
              {!session.isCurrent && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRevokeSession(session.id)}
                  disabled={revokingToken === session.id}
                >
                  {revokingToken === session.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">No active sessions found.</p>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <LogOut className="h-4 w-4 mr-2" />
                Log Out
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Log out?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will clear your local data and sign you out. Your data is safely stored in the cloud and will sync back when you log in again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={logout}>Log Out</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
      </div>
    </PageContainer>
  )
}
