"use client"

/**
 * The account's sections, each opened in the DETAIL panel from the list on
 * the account page — the way Settings works, and every other page with
 * something behind a row. The page used to be one long scroll of four cards
 * (profile, passkeys, sessions, install) with two accordions inside the first.
 *
 * Each section owns its own state; what they share (the profile, the session
 * list) comes from one SWR cache each (`account-data.ts`), because the detail
 * panel is rendered by the app shell, outside the page's own tree.
 */

import { useCallback, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { AnimatePresence, motion } from "framer-motion"
import {
  Check,
  CheckCircle2,
  Copy,
  Fingerprint,
  KeyRound,
  Loader2,
  LogOut,
  MoreVertical,
  Pencil,
  Plus,
  QrCode,
  Share,
  Trash2,
  X,
} from "lucide-react"
import { useAuth } from "@/components/providers/auth-provider"
import { useInstallOffer } from "@/components/pwa-install-prompt"
import { SwipeableCard } from "@/components/swipeable-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DetailFormPanel } from "@/components/ui/detail-form-panel"
import { FormSection } from "@/components/ui/form-section"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { base64URLDecode, base64URLEncode } from "@/lib/auth/server/webauthn"
import { getOrCreateDeviceId } from "@/lib/utils/device"
import { parseUserAgent } from "@/lib/utils/user-agent"
import {
  confirmUnsyncedLoss,
  deviceIconFor,
  formatDate,
  formatRelativeTime,
  stepUpPasskey,
  useAccountProfile,
  useAccountSessions,
  type SessionData,
} from "./account-data"

// The QR code renders only after a passkey step-up reveal — load it on demand
// instead of shipping qrcode.react with the page bundle.
const QRCodeSVG = dynamic(() => import("qrcode.react").then((m) => m.QRCodeSVG), {
  ssr: false,
  loading: () => <Skeleton className="h-[150px] w-[150px] rounded" />,
})

export type AccountSectionKey = "profile" | "passkeys" | "sessions" | "install"

/** A section's pane: title, scroller, chrome spacers. Nothing to save. */
function Pane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <DetailFormPanel
      title={title}
      dirty={false}
      canSave={false}
      saving={false}
      onSave={() => {}}
      onCancel={() => {}}
    >
      {children}
    </DetailFormPanel>
  )
}

/** Copy-to-clipboard with a brief tick, keyed so each button flips on its own. */
function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    } catch (e) {
      console.error("[Account] copy failed:", e)
    }
  }, [])
  return { copiedKey, copy }
}

// ─── Profile ────────────────────────────────────────────────

function ProfileSection() {
  const { user, updateCallsign } = useAuth()
  const { profile, refresh } = useAccountProfile()
  const { copiedKey, copy } = useCopy()

  // Inline callsign edit
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

  const openCallsignEditor = () => {
    setCallsignError("")
    setCallsignSuccess("")
    setRevealError("")
    setNewCallsign("")
    setTotpCode("")
    setTotpReveal(null)
    setIsEditingCallsign((v) => !v)
  }

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
    refresh()
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

  return (
    <Pane title="Profile">
      <FormSection>
        <div className="px-4 py-3 space-y-3">
          {/* Callsign row with inline edit */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Callsign</span>
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{profile?.callsign || user?.callsign}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground"
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
                  {callsignSuccess && <p className="text-sm text-status-valid">{callsignSuccess}</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground shrink-0">User ID</span>
            <button
              type="button"
              onClick={() => copy(profile?.userId || user?.userId || "", "userId")}
              // A 20px line of text is the whole target; the invisible
              // extension takes it to ~44px tall without moving the row.
              className="relative flex items-center gap-1.5 min-w-0 text-muted-foreground hover:text-foreground transition-colors after:absolute after:-inset-y-3 after:inset-x-0 after:content-['']"
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
              className="h-9 px-2.5 text-xs text-muted-foreground"
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
                      className="h-9 w-9 text-muted-foreground shrink-0"
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
                    onClick={() => copy(totpReveal.secret, "totpSecret")}
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
        </div>
      </FormSection>
    </Pane>
  )
}

// ─── Passkeys ───────────────────────────────────────────────

/**
 * Does THIS browser already hold a passkey for the account? A stored deviceId
 * matches — or a previous add attempt proved it (legacy keys predate the tag).
 */
export function deviceHasPasskey(
  passkeys: { deviceId: string | null }[] | undefined,
  myDeviceId: string | null
) {
  return !!myDeviceId && !!passkeys?.some((pk) => pk.deviceId && pk.deviceId === myDeviceId)
}

function PasskeysSection() {
  const { profile, isLoading, refresh } = useAccountProfile()
  // Read the per-browser device id lazily (localStorage).
  const [myDeviceId] = useState<string | null>(() =>
    typeof window !== "undefined" ? getOrCreateDeviceId() : null,
  )
  const [removingPasskey, setRemovingPasskey] = useState<string | null>(null)
  const [isAddingPasskey, setIsAddingPasskey] = useState(false)
  const [addPasskeyError, setAddPasskeyError] = useState("")
  // Set when this device is detected to already hold a passkey that predates the
  // deviceId tag (legacy) — the authenticator rejects a duplicate with
  // InvalidStateError, which we treat as "already registered here".
  const [devicePasskeyDetected, setDevicePasskeyDetected] = useState(false)

  const thisDeviceHasPasskey = devicePasskeyDetected || deviceHasPasskey(profile?.passkeys, myDeviceId)

  const handleRemovePasskey = async (credentialId: string) => {
    setRemovingPasskey(credentialId)
    try {
      const res = await fetch("/api/account/passkeys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId }),
      })
      if (res.ok) refresh()
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

      await refresh()
    } catch (err) {
      // Shouldn't normally happen now that the UI hides "Add" once this device is
      // registered, but keep it as a safety net: a duplicate on the device throws
      // InvalidStateError — treat as a no-op with a gentle note, not an error.
      if (err instanceof Error && err.name === "InvalidStateError") {
        setAddPasskeyError("")
        setDevicePasskeyDetected(true)
        await refresh()
      } else if (err instanceof Error && err.name === "NotAllowedError") {
        setAddPasskeyError("Passkey setup was cancelled.")
      } else {
        setAddPasskeyError(err instanceof Error ? err.message : "Failed to add passkey")
      }
    } finally {
      setIsAddingPasskey(false)
    }
  }

  return (
    <Pane title="Passkeys">
      <FormSection>
        <div className="py-1">
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
                id={`passkey-${pk.credentialId}`}
                variant="row"
                separated
                actions={[
                  {
                    icon: <Trash2 className="h-5 w-5" />,
                    ariaLabel: "Delete passkey",
                    variant: "destructive",
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

          <div className="px-4 pt-3 pb-2 space-y-2">
            {addPasskeyError && <p className="text-sm text-destructive">{addPasskeyError}</p>}

            {/* Only offer to add a passkey when THIS device doesn't have one.
                Otherwise confirm the device is already secured. */}
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
        </div>
      </FormSection>
      <p className="px-1 text-xs text-muted-foreground">Swipe a passkey to remove it. The last one cannot be removed.</p>
    </Pane>
  )
}

// ─── Sessions ───────────────────────────────────────────────

function SessionsSection() {
  const { logout } = useAuth()
  const { sessions, isLoading, refresh } = useAccountSessions()
  const [revokingToken, setRevokingToken] = useState<string | null>(null)

  const handleRevokeSession = async (session: SessionData) => {
    // Marked from the tap: the push before a current-session revoke can take
    // seconds, and the row should say it is working meanwhile.
    setRevokingToken(session.id)
    try {
      if (session.isCurrent && !(await confirmUnsyncedLoss())) return
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
          await logout({ skipSync: true })
          return
        }
        await refresh(
          (prev) => (prev ? { sessions: prev.sessions.filter((s) => s.id !== session.id) } : prev),
          { revalidate: true }
        )
      }
    } catch (error) {
      console.error("[Account] Failed to revoke session:", error)
    } finally {
      setRevokingToken(null)
    }
  }

  return (
    <Pane title="Active sessions">
      <FormSection>
        <div className="py-1">
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
                id={`session-${session.id}`}
                variant="row"
                separated
                actions={[
                  {
                    icon: session.isCurrent ? <LogOut className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />,
                    ariaLabel: session.isCurrent ? "Sign out this device" : "Revoke session",
                    variant: "destructive",
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
            <p className="text-sm text-muted-foreground px-4 py-2">No active sessions found.</p>
          )}
        </div>
      </FormSection>
      <p className="px-1 text-xs text-muted-foreground">Swipe a session to sign that device out.</p>
    </Pane>
  )
}

// ─── Install ────────────────────────────────────────────────

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="row-divider flex items-center gap-3 px-4 py-3">
      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">
        {n}
      </div>
      <p className="flex items-center gap-1.5 text-sm">{children}</p>
    </div>
  )
}

function InstallSection() {
  const { platform, canPrompt, install } = useInstallOffer()

  if (platform === "installed") {
    return (
      <Pane title="Install app">
        <p className="px-1 text-sm text-muted-foreground">You are using the installed app.</p>
      </Pane>
    )
  }

  return (
    <Pane title="Install app">
      <p className="px-1 text-sm text-muted-foreground">
        Installed, the logbook opens from your home screen like any other app and works offline.
      </p>
      {/* Chromium holds a real install offer: one tap opens the browser's own
          install dialog. Everywhere else the page can only describe it. */}
      {platform === "prompt" && canPrompt ? (
        <Button className="w-full" onClick={install}>
          Install app
        </Button>
      ) : platform === "ios" ? (
        <FormSection title="On iPhone or iPad">
          <Step n={1}>
            Tap the <Share className="h-4 w-4 inline text-muted-foreground" /> Share button
          </Step>
          <Step n={2}>
            Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong>
          </Step>
          <Step n={3}>
            Tap <strong>&quot;Add&quot;</strong> to confirm
          </Step>
        </FormSection>
      ) : (
        <FormSection title="From your browser">
          <Step n={1}>
            Tap the <MoreVertical className="h-4 w-4 inline text-muted-foreground" /> menu in your browser
          </Step>
          <Step n={2}>
            Tap <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home Screen&quot;</strong>
          </Step>
        </FormSection>
      )}
    </Pane>
  )
}

export function AccountSection({ section }: { section: AccountSectionKey }) {
  switch (section) {
    case "profile":
      return <ProfileSection />
    case "passkeys":
      return <PasskeysSection />
    case "sessions":
      return <SessionsSection />
    case "install":
      return <InstallSection />
  }
}
