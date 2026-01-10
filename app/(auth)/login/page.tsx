"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import {
  Fingerprint,
  Smartphone,
  Loader2,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Plane,
  Copy,
  ShieldCheck,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { base64URLEncode, base64URLDecode } from "@/lib/auth/server/webauthn"
import { useAuth } from "@/components/auth-provider"
import { getOrCreateDeviceId } from "@/lib/utils/device"

type Step =
  | "initial" // Choose login or register
  | "passkey-login" // Attempting passkey login
  | "recovery" // TOTP recovery flow
  | "register-callsign" // Enter callsign for registration
  | "register-setup" // Setup passkey + show TOTP QR
  | "register-verify" // Verify TOTP works
  | "success" // Login/register complete
  | "nudge-add-passkey" //nudge to add additional passkey for another device

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()
  const [step, setStep] = useState<Step>("initial")
  const [callsign, setCallsign] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [totpSecret, setTotpSecret] = useState("")
  const [totpUri, setTotpUri] = useState("")
  const [registrationData, setRegistrationData] = useState<{
    userId: string
    registrationOptions: PublicKeyCredentialCreationOptions
  } | null>(null)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [copied, setCopied] = useState(false)

  // Check passkey support on mount
  useEffect(() => {
    const checkPasskeySupport = async () => {
      if (
        typeof window !== "undefined" &&
        window.PublicKeyCredential &&
        PublicKeyCredential.isConditionalMediationAvailable
      ) {
        try {
          const available = await PublicKeyCredential.isConditionalMediationAvailable()
          setPasskeySupported(available)
        } catch {
          setPasskeySupported(false)
        }
      }
    }
    checkPasskeySupport()
  }, [])

  // Attempt passkey login (username-less)
  const attemptPasskeyLogin = async () => {
    setError("")
    setIsLoading(true)
    setStep("passkey-login")

    try {
      /* if (result.session) {
      } else {
        // Fallback to localStorage if no session in response
        localStorage.setItem(
          "skylog_user",
          JSON.stringify({
            id: result.user.id,
            callsign: result.user.callsign,
          })
        );
      }*/

      // Get authentication options
      const optionsRes = await fetch("/api/auth/login/passkey", {
        cache: "no-store",
      })
      if (!optionsRes.ok) throw new Error("Failed to get options")
      const options = await optionsRes.json()

      const rpId = window.location.hostname

      // Start WebAuthn authentication
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64URLDecode(options.challenge),
          rpId: rpId,
          timeout: options.timeout,
          userVerification: options.userVerification,
        },
      })

      if (!credential) throw new Error("No credential returned")

      const pubKeyCred = credential as PublicKeyCredential
      const response = pubKeyCred.response as AuthenticatorAssertionResponse

      // Send to server
      const verifyRes = await fetch("/api/auth/login/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: getOrCreateDeviceId(),
          credential: {
            id: pubKeyCred.id,
            rawId: base64URLEncode(pubKeyCred.rawId),
            response: {
              clientDataJSON: base64URLEncode(response.clientDataJSON),
              authenticatorData: base64URLEncode(response.authenticatorData),
              signature: base64URLEncode(response.signature),
              userHandle: response.userHandle ? base64URLEncode(response.userHandle) : null,
            },
            type: pubKeyCred.type,
          },
          challenge: options.challenge,
        }),
      })

      if (!verifyRes.ok) throw new Error("Login failed")
      const result = await verifyRes.json()

      if (result.session) {
        await login({
          userId: result.user.id,
          callsign: result.user.callsign,
          sessionToken: result.session.token,
          expiresAt:
            typeof result.session.expiresAt === "string"
              ? new Date(result.session.expiresAt).getTime() // ✅ Ensure expiresAt is a Number for IndexedDB
              : result.session.expiresAt,
        })
      }

      setStep("success")
      setTimeout(() => router.push("/"), 1500)
    } catch (err) {
      console.error("Passkey login error:", err)
      setStep("initial")
      if (err instanceof Error && err.name === "NotAllowedError") {
        // User cancelled or no passkey found
        setError("No passkey found on this device. Try recovery or register.")
      } else {
        setError(err instanceof Error ? err.message : "Login failed")
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Verify TOTP works during registration
  const verifyTotpSetup = async () => {
    if (totpCode.length !== 6) {
      setError("Enter the 6-digit code")
      return
    }

    setError("")
    setIsLoading(true)

    try {
      const res = await fetch("/api/auth/login/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callsign,
          code: totpCode,
          deviceId: getOrCreateDeviceId(),
        }),
      })

      if (!res.ok) {
        throw new Error("Invalid code. Make sure you scanned the QR code correctly.")
      }
      const data = await res.json()

      // ✅ Consistency: Ensure Numeric timestamp for local state
      await login({
        userId: data.user.id,
        callsign: data.user.callsign,
        sessionToken: data.session?.token || "",
        expiresAt: new Date(data.session.expiresAt).getTime(),
      })

      setStep("success")
      setTimeout(() => router.push("/"), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed")
    } finally {
      setIsLoading(false)
    }
  }

  // Start registration flow
  const startRegistration = async () => {
    if (!callsign.trim() || callsign.trim().length < 2) {
      setError("Callsign must be at least 2 characters")
      return
    }

    setError("")
    setIsLoading(true)

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callsign: callsign.trim() }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Registration failed")
      }

      const data = await res.json()
      setTotpSecret(data.totpSecret)
      setTotpUri(data.totpUri)
      setRegistrationData({
        userId: data.userId,
        registrationOptions: data.registrationOptions,
      })
      setStep("register-setup")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed")
    } finally {
      setIsLoading(false)
    }
  }

  // Complete passkey registration
  const registerPasskey = async () => {
    if (!registrationData) return

    setError("")
    setIsLoading(true)

    try {
      const options = registrationData.registrationOptions

      const rpId = window.location.hostname

      // to avoid passing incompatible authenticatorSelection settings
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: base64URLDecode(options.challenge as unknown as string),
          rp: {
            name: "SkyLog Pilot Logbook",
            id: rpId,
          },
          user: {
            id: base64URLDecode(options.user.id as unknown as string),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          attestation: options.attestation || "none",
          authenticatorSelection: {
            residentKey: "preferred",
            userVerification: "preferred",
            authenticatorAttachment: "platform", // Use platform authenticator (Google Password Manager, Face ID, etc.)
          },
          excludeCredentials:
            options.excludeCredentials?.map(
              (cred: {
                id: string
                type: "public-key"
                transports?: AuthenticatorTransport[]
              }) => ({
                id: base64URLDecode(cred.id as unknown as string),
                type: cred.type,
                transports: cred.transports,
              }),
            ) || [],
        },
      })

      if (!credential) throw new Error("No credential created")

      const pubKeyCred = credential as PublicKeyCredential
      const response = pubKeyCred.response as AuthenticatorAttestationResponse

      // Complete registration
      const completeRes = await fetch("/api/auth/register/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: registrationData.userId,
          callsign: callsign.trim(),
          totpSecret,
          credential: {
            id: pubKeyCred.id,
            rawId: base64URLEncode(pubKeyCred.rawId),
            response: {
              clientDataJSON: base64URLEncode(response.clientDataJSON),
              attestationObject: base64URLEncode(response.attestationObject),
              publicKey: response.getPublicKey ? base64URLEncode(response.getPublicKey()!) : "",
              transports: response.getTransports?.() || [],
            },
            type: pubKeyCred.type,
            authenticatorAttachment: (
              pubKeyCred as PublicKeyCredential & {
                authenticatorAttachment?: string
              }
            ).authenticatorAttachment,
          },
          challenge: options.challenge,
          deviceId: getOrCreateDeviceId(),
        }),
      })

      if (!completeRes.ok) {
        const err = await completeRes.json()
        throw new Error(err.error || "Registration failed")
      }

      const result = await completeRes.json()

      // Store user info
      localStorage.setItem(
        "skylog_user",
        JSON.stringify({
          id: result.user.id,
          callsign: result.user.callsign,
        }),
      )

      // Move to verify TOTP step
      setStep("register-verify")
    } catch (err) {
      console.error("Passkey registration error:", err)
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Passkey registration was cancelled. Please try again.")
      } else {
        setError(err instanceof Error ? err.message : "Registration failed")
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Recovery login with TOTP
  const recoveryLogin = async () => {
    if (!callsign.trim()) {
      setError("Enter your callsign")
      return
    }
    if (totpCode.length !== 6) {
      setError("Enter the 6-digit code")
      return
    }

    setError("")
    setIsLoading(true)

    try {
      const res = await fetch("/api/auth/login/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callsign,
          code: totpCode,
          deviceId: getOrCreateDeviceId(),
        }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || "Invalid callsign or code")

      await login({
        userId: result.user.id,
        callsign: result.user.callsign,
        sessionToken: result.session?.token || "",
        expiresAt: new Date(result.session.expiresAt).getTime(),
      })

      setStep("nudge-add-passkey")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setIsLoading(false)
    }
  }

  const registerAdditionalPasskey = async () => {
    setIsLoading(true)
    setError("")

    try {
      // 1. Get registration options (This route requires valid session)
      console.log("[v0] Starting passkey registration...")
      const optionsRes = await fetch("/api/auth/register/add-passkey", {
        cache: "no-store",
      })

      if (!optionsRes.ok) {
        const errData = await optionsRes.json().catch(() => ({}))
        console.log("[v0] Failed to get options:", errData)
        throw new Error(errData.error || "Failed to initialize setup")
      }

      const options = await optionsRes.json()
      console.log("[v0] Received options:", JSON.stringify(options, null, 2))

      if (!options.challenge || !options.user?.id || !options.user?.name) {
        console.log("[v0] Missing required fields in options")
        throw new Error("Invalid registration options from server")
      }

      const rpId = window.location.hostname
      console.log("[v0] Using rpId:", rpId)

      // 2. Browser Hardware Handshake
      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64URLDecode(options.challenge),
        rp: {
          name: options.rp?.name || "SkyLog Pilot Logbook",
          id: rpId,
        },
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
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
          authenticatorAttachment: "platform",
        },
        excludeCredentials:
          options.excludeCredentials?.map((cred: any) => ({
            id: typeof cred.id === "string" ? base64URLDecode(cred.id) : new Uint8Array(Object.values(cred.id)),
            type: "public-key" as const,
            transports: cred.transports,
          })) || [],
      }

      console.log("[v0] Calling navigator.credentials.create...")

      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions,
      })

      if (!credential) {
        console.log("[v0] No credential returned")
        throw new Error("Cancelled")
      }

      console.log("[v0] Credential created:", credential.id)
      const pubKeyCred = credential as PublicKeyCredential
      const response = pubKeyCred.response as AuthenticatorAttestationResponse

      // 3. Save new passkey to DB
      console.log("[v0] Saving passkey to server...")
      const completeRes = await fetch("/api/auth/register/add-passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge: options.challenge,
          credential: {
            id: pubKeyCred.id,
            response: {
              clientDataJSON: base64URLEncode(response.clientDataJSON),
              attestationObject: base64URLEncode(response.attestationObject),
              publicKey: response.getPublicKey ? base64URLEncode(response.getPublicKey()!) : "",
            },
          },
        }),
      })

      if (!completeRes.ok) {
        const errData = await completeRes.json().catch(() => ({}))
        console.log("[v0] Failed to save passkey:", errData)
        throw new Error(errData.error || "Failed to save passkey")
      }

      console.log("[v0] Passkey saved successfully")
      // 4. Final Success
      setStep("success")
      setTimeout(() => router.push("/"), 1500)
    } catch (err) {
      console.error("[v0] Add passkey error:", err)
      if (err instanceof Error && err.name === "NotAllowedError") {
        // User cancelled the prompt
        setError("Passkey setup was cancelled. You can try again or skip.")
      } else if (err instanceof Error && err.message === "Cancelled") {
        setError("Passkey setup was cancelled. You can try again or skip.")
      } else {
        setError(err instanceof Error ? err.message : "Failed to set up passkey. You can try again or skip.")
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Helpers for Copying
  const copyToClipboard = () => {
    navigator.clipboard.writeText(totpSecret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 safe-area-inset">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Plane className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">SkyLog</h1>
          <p className="text-muted-foreground text-sm">Pilot Logbook</p>
        </div>

        {/* Initial Step */}
        {step === "initial" && (
          <Card className="border-border">
            <CardHeader className="text-center">
              <CardTitle>Welcome</CardTitle>
              <CardDescription>Sign in with your passkey or create an account</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {passkeySupported && (
                <Button className="w-full h-12 text-base" onClick={attemptPasskeyLogin} disabled={isLoading}>
                  <Fingerprint className="mr-2 h-5 w-5" />
                  Sign in with Passkey
                </Button>
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full h-12 text-base bg-transparent"
                onClick={() => {
                  setError("")
                  setStep("recovery")
                }}
              >
                <Smartphone className="mr-2 h-5 w-5" />
                Recovery (Authenticator)
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setError("")
                  setStep("register-callsign")
                }}
              >
                Create new account
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Passkey Login Loading */}
        {step === "passkey-login" && (
          <Card className="border-border">
            <CardContent className="py-12 text-center">
              <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary mb-4" />
              <p className="text-foreground font-medium">Waiting for passkey...</p>
              <p className="text-muted-foreground text-sm mt-1">Use Face ID, Touch ID, or your device PIN</p>
            </CardContent>
          </Card>
        )}

        {/* Recovery Flow */}
        {step === "recovery" && (
          <Card className="border-border">
            <CardHeader>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit -ml-2 mb-2"
                onClick={() => {
                  setStep("initial")
                  setError("")
                  setCallsign("")
                  setTotpCode("")
                }}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <CardTitle>Account Recovery</CardTitle>
              <CardDescription>Enter your callsign and authenticator code</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Callsign</label>
                <Input
                  placeholder="Your callsign (e.g., Maverick)"
                  value={callsign}
                  onChange={(e) => setCallsign(e.target.value)}
                  className="h-12 text-base"
                />
                <p className="text-xs text-muted-foreground">
                  Check your authenticator app label: SkyLog:{"{callsign}"}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Authenticator Code</label>
                <InputOTP maxLength={6} value={totpCode} onChange={setTotpCode} className="justify-center">
                  <InputOTPGroup>
                    <InputOTPSlot index={0} className="h-12 w-10 text-lg" />
                    <InputOTPSlot index={1} className="h-12 w-10 text-lg" />
                    <InputOTPSlot index={2} className="h-12 w-10 text-lg" />
                    <InputOTPSlot index={3} className="h-12 w-10 text-lg" />
                    <InputOTPSlot index={4} className="h-12 w-10 text-lg" />
                    <InputOTPSlot index={5} className="h-12 w-10 text-lg" />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button className="w-full h-12" onClick={recoveryLogin} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Sign In
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Register - Callsign */}
        {step === "register-callsign" && (
          <Card className="border-border">
            <CardHeader>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit -ml-2 mb-2"
                onClick={() => {
                  setStep("initial")
                  setError("")
                  setCallsign("")
                }}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <CardTitle>Create Account</CardTitle>
              <CardDescription>Choose a callsign for your pilot profile</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Callsign</label>
                <Input
                  placeholder="e.g., Maverick, Goose, Iceman"
                  value={callsign}
                  onChange={(e) => setCallsign(e.target.value)}
                  className="h-12 text-base"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">This will be your display name and recovery identifier</p>
              </div>

              <Button className="w-full h-12" onClick={startRegistration} disabled={isLoading || !callsign.trim()}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Continue
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Register - Setup */}
        {step === "register-setup" && (
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Setup Authentication</CardTitle>
              <CardDescription>First, save your recovery code. Then create a passkey.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* TOTP Setup */}
              <div className="space-y-3">
                <h3 className="font-medium text-sm">1. Save Recovery Code</h3>
                <p className="text-xs text-muted-foreground">
                  Scan this QR code with Google Authenticator, Authy, or similar app
                </p>
                <div className="flex justify-center p-4 bg-white rounded-lg">
                  <QRCodeSVG value={totpUri} size={180} />
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Or enter manually:</p>
                  <code
                    onClick={copyToClipboard}
                    className="flex justify-center gap-2 max-w-full text-xs bg-muted px-3 py-2 rounded-md font-mono break-all hover:bg-muted/80 transition-colors"
                  >
                    {totpSecret}
                    {copied ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    )}
                  </code>
                </div>
              </div>

              {/* Passkey Setup */}
              <div className="space-y-3">
                <h3 className="font-medium text-sm">2. Create Passkey</h3>
                <p className="text-xs text-muted-foreground">
                  This enables fast login with Face ID, Touch ID, or device PIN
                </p>
                <Button className="w-full h-12" onClick={registerPasskey} disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Fingerprint className="h-5 w-5 mr-2" />
                  )}
                  Create Passkey
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Register - Verify TOTP */}
        {step === "register-verify" && (
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Verify Setup</CardTitle>
              <CardDescription>Enter the code from your authenticator app to confirm setup</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <InputOTP maxLength={6} value={totpCode} onChange={setTotpCode} className="justify-center">
                <InputOTPGroup>
                  <InputOTPSlot index={0} className="h-12 w-10 text-lg" />
                  <InputOTPSlot index={1} className="h-12 w-10 text-lg" />
                  <InputOTPSlot index={2} className="h-12 w-10 text-lg" />
                  <InputOTPSlot index={3} className="h-12 w-10 text-lg" />
                  <InputOTPSlot index={4} className="h-12 w-10 text-lg" />
                  <InputOTPSlot index={5} className="h-12 w-10 text-lg" />
                </InputOTPGroup>
              </InputOTP>

              <Button className="w-full h-12" onClick={verifyTotpSetup} disabled={isLoading || totpCode.length !== 6}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Complete Setup
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Success */}
        {step === "success" && (
          <Card className="border-border">
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-chart-2/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-chart-2" />
              </div>
              <p className="text-foreground font-medium text-lg">Welcome aboard!</p>
              <p className="text-muted-foreground text-sm mt-1">Redirecting to your logbook...</p>
            </CardContent>
          </Card>
        )}

        {step === "nudge-add-passkey" && (
          <Card className="border-primary/50 shadow-lg">
            <CardHeader className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Secure this device?</CardTitle>
              <CardDescription>
                Would you like to use FaceID or TouchID to log in faster next time on this device?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full h-12" onClick={registerAdditionalPasskey} disabled={isLoading}>
                {isLoading ? <Loader2 className="animate-spin mr-2" /> : <Fingerprint className="mr-2" />}
                Enable Passkey
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => router.push("/")} disabled={isLoading}>
                Skip and go to Logbook
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
