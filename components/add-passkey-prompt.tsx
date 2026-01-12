"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Fingerprint, Loader2, X } from "lucide-react"
import { base64URLEncode } from "@/lib/webauthn"

export function AddPasskeyPrompt() {
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    // Check if we should prompt for passkey registration
    if (searchParams.get("addPasskey") === "true") {
      setOpen(true)
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname)
    }
  }, [searchParams])

  const addPasskey = async () => {
    setError("")
    setIsLoading(true)

    try {
      // Get registration options
      const optionsRes = await fetch("/api/auth/passkey/add")
      if (!optionsRes.ok) throw new Error("Failed to get options")

      const options = await optionsRes.json()

      // Create credential
      const credential = await navigator.credentials.create({
        publicKey: {
          ...options,
          challenge: base64URLDecode(options.challenge),
          user: {
            ...options.user,
            id: base64URLDecode(options.user.id),
          },
          excludeCredentials: options.excludeCredentials?.map((c: { id: string }) => ({
            ...c,
            id: base64URLDecode(c.id),
          })),
        },
      })

      if (!credential) throw new Error("No credential created")

      const pubKeyCred = credential as PublicKeyCredential
      const response = pubKeyCred.response as AuthenticatorAttestationResponse

      // Save credential
      const saveRes = await fetch("/api/auth/passkey/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          },
          challenge: options.challenge,
        }),
      })

      if (!saveRes.ok) throw new Error("Failed to save passkey")

      setOpen(false)
    } catch (err) {
      console.error("Add passkey error:", err)
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Passkey registration was cancelled")
      } else {
        setError(err instanceof Error ? err.message : "Failed to add passkey")
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Passkey to This Device</DialogTitle>
          <DialogDescription>
            You signed in with your recovery code. Add a passkey to this device for faster logins.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button className="flex-1" onClick={addPasskey} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Fingerprint className="h-4 w-4 mr-2" />}
              Add Passkey
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
              <X className="h-4 w-4 mr-2" />
              Skip
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function base64URLDecode(str: string): ArrayBuffer {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}
