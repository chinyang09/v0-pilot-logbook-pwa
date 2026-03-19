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
} from "lucide-react"

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
  token: string
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

  const handleRevokeSession = async (token: string) => {
    setRevokingToken(token)
    try {
      const res = await fetch("/api/account/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken: token }),
      })

      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.token !== token))
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

  const handleAddPasskey = () => {
    window.location.href = "/api/auth/passkey/add"
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

          <Button variant="outline" size="sm" onClick={handleAddPasskey} className="mt-2">
            <Plus className="h-4 w-4 mr-2" />
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
              key={session.token}
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
                  onClick={() => handleRevokeSession(session.token)}
                  disabled={revokingToken === session.token}
                >
                  {revokingToken === session.token ? (
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
