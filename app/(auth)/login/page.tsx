"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import {
  Fingerprint,
  Smartphone,
  Loader2,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Copy,
  ShieldCheck,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { base64URLEncode, base64URLDecode } from "@/lib/auth/server/webauthn"
import { useAuth } from "@/components/providers/auth-provider"
import { getOrCreateDeviceId } from "@/lib/utils/device"
import { motion, AnimatePresence } from "framer-motion"
import { GlassContainer } from "@/components/ui/glass-container"
import { BorderBeam } from "@/components/ui/border-beam"

type Step =
  | "initial" // Choose login or register
  | "passkey-login" // Attempting passkey login
  | "recovery" // TOTP recovery flow
  | "register-callsign" // Enter callsign for registration
  | "register-setup" // Setup passkey + show TOTP QR
  | "register-verify" // Verify TOTP works
  | "success" // Login/register complete
  | "nudge-add-passkey" //nudge to add additional passkey for another device

const stepVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

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
  const [mounted, setMounted] = useState(false)
  const [totpStatus, setTotpStatus] = useState<"idle" | "loading" | "success" | "error">("idle")

  useEffect(() => {
    setMounted(true)
  }, [])

  // Auto-submit TOTP once BOTH the 6-digit code and (for recovery) the callsign
  // are present — order-independent. Debounced so mid-typing the callsign never
  // submits a partial value, and so entering the code first then the callsign
  // still triggers login (the old version fired on code-complete only and got
  // stuck on the empty-callsign early-return).
  const autoSubmitRef = useRef(false)
  useEffect(() => {
    if (totpCode.length < 6) {
      autoSubmitRef.current = false
      return
    }
    if (step !== "recovery" && step !== "register-verify") return
    const callsignReady = step === "register-verify" || callsign.trim().length >= 2
    if (!callsignReady || isLoading || autoSubmitRef.current) return

    const timer = setTimeout(() => {
      autoSubmitRef.current = true
      // Blur OTP input to dismiss focus ring
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      if (step === "recovery") {
        recoveryLogin()
      } else {
        verifyTotpSetup()
      }
    }, 300)
    return () => clearTimeout(timer)
    // The submit handlers are recreated each render and intentionally excluded so
    // this doesn't fire every render; it's keyed on the code/callsign/step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totpCode, callsign, step, isLoading])

  // Show the passkey button whenever the browser supports WebAuthn. Gating on
  // isConditionalMediationAvailable() (autofill support) was wrong — it hid the
  // button on browsers that support passkeys but not conditional UI (Firefox,
  // older Safari), funnelling those users into TOTP recovery unnecessarily. For
  // a username-less discoverable login the button is the right entry point; if
  // no passkey exists, get() rejects with NotAllowedError and we explain.
  useEffect(() => {
    setPasskeySupported(typeof window !== "undefined" && !!window.PublicKeyCredential)
  }, [])

  // Attempt passkey login (username-less)
  const attemptPasskeyLogin = async () => {
    setError("")
    setIsLoading(true)
    setStep("passkey-login")

    try {
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
              ? new Date(result.session.expiresAt).getTime()
              : result.session.expiresAt,
        })
      }

      setStep("success")
      setTimeout(() => router.push("/"), 1500)
    } catch (err) {
      console.error("Passkey login error:", err)
      setStep("initial")
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Passkey sign-in was cancelled or no passkey was found. Use a recovery code or create an account.")
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
    setTotpStatus("loading")

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

      await login({
        userId: data.user.id,
        callsign: data.user.callsign,
        sessionToken: data.session?.token || "",
        expiresAt: new Date(data.session.expiresAt).getTime(),
      })

      setTotpStatus("success")
      setTimeout(() => {
        setStep("success")
        setTotpStatus("idle")
      }, 600)
      setTimeout(() => router.push("/"), 2100)
    } catch (err) {
      setTotpStatus("error")
      setTotpCode("")
      setError(err instanceof Error ? err.message : "Verification failed")
      setTimeout(() => setTotpStatus("idle"), 1000)
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

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: base64URLDecode(options.challenge as unknown as string),
          rp: {
            name: "OOOI Pilot Logbook",
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
            residentKey: "required",
            requireResidentKey: true,
            userVerification: "required",
          },
          excludeCredentials:
            (options.excludeCredentials as Array<{
              id: string
              type: "public-key"
              transports?: AuthenticatorTransport[]
            }> | undefined)?.map((cred) => ({
                id: base64URLDecode(cred.id as unknown as string),
                type: cred.type,
                transports: cred.transports,
              })) || [],
        },
      })

      if (!credential) throw new Error("No credential created")

      const pubKeyCred = credential as PublicKeyCredential
      const response = pubKeyCred.response as AuthenticatorAttestationResponse

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

      localStorage.setItem(
        "skylog_user",
        JSON.stringify({
          id: result.user.id,
          callsign: result.user.callsign,
        }),
      )

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
    setTotpStatus("loading")

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

      setTotpStatus("success")
      setTimeout(() => {
        setStep("nudge-add-passkey")
        setTotpStatus("idle")
      }, 600)
    } catch (err) {
      setTotpStatus("error")
      setTotpCode("")
      setError(err instanceof Error ? err.message : "Login failed")
      setTimeout(() => setTotpStatus("idle"), 1000)
    } finally {
      setIsLoading(false)
    }
  }

  const registerAdditionalPasskey = async () => {
    setIsLoading(true)
    setError("")

    try {
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

      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64URLDecode(options.challenge),
        rp: {
          name: options.rp?.name || "OOOI Pilot Logbook",
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
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        excludeCredentials:
          options.excludeCredentials?.map((cred: any) => {
            const desc: PublicKeyCredentialDescriptor = {
              id: typeof cred.id === "string" ? base64URLDecode(cred.id) : new Uint8Array(Object.values(cred.id)),
              type: "public-key",
            }
            if (Array.isArray(cred.transports) && cred.transports.every((t: unknown) => typeof t === "string")) {
              desc.transports = cred.transports as AuthenticatorTransport[]
            }
            return desc
          }) || [],
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
      setStep("success")
      setTimeout(() => router.push("/"), 1500)
    } catch (err) {
      console.error("[v0] Add passkey error:", err)
      if (err instanceof Error && err.name === "NotAllowedError") {
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

  const copyToClipboard = () => {
    navigator.clipboard.writeText(totpSecret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // TOTP status class for OTP input group (loading is handled by <BorderBeam/>)
  const totpInputClass = totpStatus === "success" ? "totp-success" :
    totpStatus === "error" ? "totp-error" : ""

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 safe-area-inset">
      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 20 }}
        animate={mounted ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* OOOI Branding */}
        <div className="flex flex-col items-center mb-8">
          <h1 className="text-5xl font-bold text-white tracking-[0.3em] mb-1">
            OOOI
          </h1>
          <p className="text-white/50 text-xs tracking-[0.5em] uppercase font-medium">
            Out &middot; Off &middot; On &middot; In
          </p>
        </div>

        {/* Step content with animated transitions */}
        <AnimatePresence mode="wait">
          {/* Initial Step */}
          {step === "initial" && (
            <motion.div
              key="initial"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <GlassContainer cornerRadius={16}>
                <div className="px-6 pt-6 pb-2 text-center">
                  <h2 className="text-lg font-semibold text-white">Welcome back</h2>
                  <p className="text-sm text-white/60 mt-1">Sign in to your logbook</p>
                </div>
                <div className="px-6 pb-6 pt-4 space-y-4">
                  {error && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/15 border border-red-500/25 rounded-lg text-sm text-red-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {passkeySupported && (
                    <Button
                      className="w-full h-12 text-base bg-white/15 hover:bg-white/25 text-white border border-white/20 backdrop-blur-sm transition-all active:scale-[1.03]"
                      onClick={attemptPasskeyLogin}
                      disabled={isLoading}
                    >
                      <Fingerprint className="mr-2 h-5 w-5" />
                      Sign in with Passkey
                    </Button>
                  )}

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-white/15" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="px-3 text-white/40">or</span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full h-12 text-base bg-transparent text-white/80 border-white/20 hover:bg-white/10 hover:text-white transition-all active:scale-[1.03]"
                    onClick={() => {
                      setError("")
                      setStep("recovery")
                    }}
                  >
                    <Smartphone className="mr-2 h-5 w-5" />
                    Authenticator Code
                  </Button>

                  <Button
                    variant="ghost"
                    className="w-full text-white/50 hover:text-white hover:bg-white/10 active:scale-[1.03] transition-transform"
                    onClick={() => {
                      setError("")
                      setStep("register-callsign")
                    }}
                  >
                    Create new account
                  </Button>
                </div>
              </GlassContainer>
            </motion.div>
          )}

          {/* Passkey Login Loading */}
          {step === "passkey-login" && (
            <motion.div
              key="passkey-login"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <GlassContainer cornerRadius={16}>
                <div className="py-12 text-center">
                  <Loader2 className="h-12 w-12 animate-spin mx-auto text-white/80 mb-4" />
                  <p className="text-white font-medium">Waiting for passkey...</p>
                  <p className="text-white/60 text-sm mt-1">Use Face ID, Touch ID, or your device PIN</p>
                </div>
              </GlassContainer>
            </motion.div>
          )}

          {/* Recovery Flow */}
          {step === "recovery" && (
            <motion.div
              key="recovery"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <GlassContainer cornerRadius={16}>
                <div className="px-6 pt-6 pb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit -ml-2 mb-2 text-white/70 hover:text-white hover:bg-white/10 active:scale-[1.03] transition-transform"
                    onClick={() => {
                      setStep("initial")
                      setError("")
                      setCallsign("")
                      setTotpCode("")
                      setTotpStatus("idle")
                    }}
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                  <h2 className="text-lg font-semibold text-white text-center">Account Recovery</h2>
                  <p className="text-sm text-white/60 mt-1 text-center">Enter your callsign and authenticator code</p>
                </div>
                <div className="px-6 pb-6 pt-4 space-y-4">
                  {error && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/15 border border-red-500/25 rounded-lg text-sm text-red-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Input
                      placeholder="Callsign"
                      value={callsign}
                      onChange={(e) => setCallsign(e.target.value)}
                      className="h-12 text-base bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-white/30"
                    />
                    <p className="text-xs text-white/40 text-center">
                      Check your authenticator app label: OOOI:{"{callsign}"}
                    </p>
                  </div>

                  <div className="flex justify-center">
                    <InputOTP maxLength={6} value={totpCode} onChange={setTotpCode} className="justify-center" disabled={isLoading}>
                      <BorderBeam active={totpStatus === "loading"} radius="0.55rem">
                        <InputOTPGroup className={totpInputClass}>
                          <InputOTPSlot index={0} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={1} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={2} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={3} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={4} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={5} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                        </InputOTPGroup>
                      </BorderBeam>
                    </InputOTP>
                  </div>
                </div>
              </GlassContainer>
            </motion.div>
          )}

          {/* Register - Callsign */}
          {step === "register-callsign" && (
            <motion.div
              key="register-callsign"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <GlassContainer cornerRadius={16}>
                <div className="px-6 pt-6 pb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit -ml-2 mb-2 text-white/70 hover:text-white hover:bg-white/10 active:scale-[1.03] transition-transform"
                    onClick={() => {
                      setStep("initial")
                      setError("")
                      setCallsign("")
                    }}
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                  <h2 className="text-lg font-semibold text-white text-center">Create Account</h2>
                  <p className="text-sm text-white/60 mt-1 text-center">Choose a callsign for your pilot profile</p>
                </div>
                <div className="px-6 pb-6 pt-4 space-y-4">
                  {error && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/15 border border-red-500/25 rounded-lg text-sm text-red-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Input
                      placeholder="Callsign"
                      value={callsign}
                      onChange={(e) => setCallsign(e.target.value)}
                      className="h-12 text-base bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-white/30"
                      autoFocus
                    />
                    <p className="text-xs text-white/40 text-center">This will be your display name and recovery identifier</p>
                  </div>

                  <Button
                    className="w-full h-12 bg-white/15 hover:bg-white/25 text-white border border-white/20 backdrop-blur-sm transition-all active:scale-[1.03]"
                    onClick={startRegistration}
                    disabled={isLoading || !callsign.trim()}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Continue
                  </Button>
                </div>
              </GlassContainer>
            </motion.div>
          )}

          {/* Register - Setup */}
          {step === "register-setup" && (
            <motion.div
              key="register-setup"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <GlassContainer cornerRadius={16}>
                <div className="px-6 pt-6 pb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit -ml-2 mb-2 text-white/70 hover:text-white hover:bg-white/10 active:scale-[1.03] transition-transform"
                    onClick={() => {
                      setStep("register-callsign")
                      setError("")
                      setTotpSecret("")
                      setTotpUri("")
                      setRegistrationData(null)
                    }}
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                  <h2 className="text-lg font-semibold text-white text-center">Setup Authentication</h2>
                  <p className="text-sm text-white/60 mt-1 text-center">First, save your recovery code. Then create a passkey.</p>
                </div>
                <div className="px-6 pb-6 pt-4 space-y-6">
                  {error && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/15 border border-red-500/25 rounded-lg text-sm text-red-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* TOTP Setup */}
                  <div className="space-y-3">
                    <h3 className="font-medium text-sm text-white/90 text-center">1. Save Recovery Code</h3>
                    <p className="text-xs text-white/50 text-center">
                      Scan this QR code with Google Authenticator, Authy, or similar app
                    </p>
                    <div className="flex justify-center p-4 bg-white rounded-lg">
                      <QRCodeSVG value={totpUri} size={180} />
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-white/50 mb-1">Or enter manually:</p>
                      <code
                        onClick={copyToClipboard}
                        className="flex justify-center gap-2 max-w-full text-xs bg-white/10 px-3 py-2 rounded-md font-mono break-all text-white/80 hover:bg-white/15 transition-colors cursor-pointer"
                      >
                        {totpSecret}
                        {copied ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                        ) : (
                          <Copy className="h-3 w-3 text-white/50 flex-shrink-0" />
                        )}
                      </code>
                    </div>
                  </div>

                  {/* Passkey Setup */}
                  <div className="space-y-3">
                    <h3 className="font-medium text-sm text-white/90 text-center">2. Create Passkey</h3>
                    <p className="text-xs text-white/50 text-center">
                      This enables fast login with Face ID, Touch ID, or device PIN
                    </p>
                    <Button
                      className="w-full h-12 bg-white/15 hover:bg-white/25 text-white border border-white/20 backdrop-blur-sm transition-all active:scale-[1.03]"
                      onClick={registerPasskey}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Fingerprint className="h-5 w-5 mr-2" />
                      )}
                      Create Passkey
                    </Button>
                  </div>
                </div>
              </GlassContainer>
            </motion.div>
          )}

          {/* Register - Verify TOTP */}
          {step === "register-verify" && (
            <motion.div
              key="register-verify"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <GlassContainer cornerRadius={16}>
                <div className="px-6 pt-6 pb-2 text-center">
                  <h2 className="text-lg font-semibold text-white">Verify Setup</h2>
                  <p className="text-sm text-white/60 mt-1">Enter the code from your authenticator app to confirm setup</p>
                </div>
                <div className="px-6 pb-6 pt-4 space-y-4">
                  {error && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/15 border border-red-500/25 rounded-lg text-sm text-red-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="flex justify-center">
                    <InputOTP maxLength={6} value={totpCode} onChange={setTotpCode} className="justify-center" disabled={isLoading}>
                      <BorderBeam active={totpStatus === "loading"} radius="0.55rem">
                        <InputOTPGroup className={totpInputClass}>
                          <InputOTPSlot index={0} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={1} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={2} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={3} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={4} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                          <InputOTPSlot index={5} className="h-12 w-10 text-lg bg-white/10 border-white/20 text-white" />
                        </InputOTPGroup>
                      </BorderBeam>
                    </InputOTP>
                  </div>
                </div>
              </GlassContainer>
            </motion.div>
          )}

          {/* Success */}
          {step === "success" && (
            <motion.div
              key="success"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <GlassContainer cornerRadius={16}>
                <div className="py-12 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                  >
                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                    </div>
                  </motion.div>
                  <p className="text-white font-medium text-lg">Welcome aboard!</p>
                  <p className="text-white/60 text-sm mt-1">Redirecting to your logbook...</p>
                </div>
              </GlassContainer>
            </motion.div>
          )}

          {/* Nudge Add Passkey */}
          {step === "nudge-add-passkey" && (
            <motion.div
              key="nudge-add-passkey"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <GlassContainer cornerRadius={16}>
                <div className="px-6 pt-6 pb-2 text-center">
                  <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3">
                    <ShieldCheck className="h-6 w-6 text-white/80" />
                  </div>
                  <h2 className="text-lg font-semibold text-white">Secure this device?</h2>
                  <p className="text-sm text-white/60 mt-1">
                    Would you like to use FaceID or TouchID to log in faster next time on this device?
                  </p>
                </div>
                <div className="px-6 pb-6 pt-4 space-y-3">
                  {error && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/15 border border-red-500/25 rounded-lg text-sm text-red-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                  <Button
                    className="w-full h-12 bg-white/15 hover:bg-white/25 text-white border border-white/20 backdrop-blur-sm transition-all active:scale-[1.03]"
                    onClick={registerAdditionalPasskey}
                    disabled={isLoading}
                  >
                    {isLoading ? <Loader2 className="animate-spin mr-2" /> : <Fingerprint className="mr-2" />}
                    Enable Passkey
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full text-white/50 hover:text-white hover:bg-white/10 active:scale-[1.03] transition-transform"
                    onClick={() => router.push("/")}
                    disabled={isLoading}
                  >
                    Skip and go to Logbook
                  </Button>
                </div>
              </GlassContainer>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
