import type { Db } from "mongodb"
import type { User, StoredChallenge } from "@/lib/auth/types"
import {
  generateAuthenticationOptions,
  base64URLEncode,
  base64URLDecode,
  verifyAuthenticationResponse,
  getRP,
  getExpectedOrigin,
} from "@/lib/auth/server/webauthn"

const STEP_UP_TTL_MS = 60_000

export interface StepUpAssertion {
  challenge: string
  credential: {
    id: string
    response: {
      authenticatorData: string
      clientDataJSON: string
      signature: string
    }
  }
}

/**
 * Issue a short-lived, user-bound WebAuthn challenge for a "step-up" ceremony —
 * re-proving possession of a passkey before a sensitive account action (reveal
 * the TOTP seed, change the callsign). The challenge is scoped to the logged-in
 * user's own credentials so only their passkeys can satisfy it.
 */
export async function issueStepUpChallenge(db: Db, userId: string, host?: string) {
  const user = await db.collection<User>("users").findOne({ _id: userId as never })
  if (!user) return null

  const options = generateAuthenticationOptions(user.auth.passkeys, host)
  const challengeBase64 = base64URLEncode(options.challenge as Uint8Array)

  await db.collection<StoredChallenge>("challenges").insertOne({
    _id: challengeBase64,
    userId,
    type: "step-up",
    expiresAt: new Date(Date.now() + STEP_UP_TTL_MS),
  })

  return {
    challenge: challengeBase64,
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification,
    allowCredentials: (user.auth.passkeys || []).map((p) => ({
      id: p.id,
      type: "public-key" as const,
      // Only emit transports when valid (see add-passkey route rationale).
      ...(Array.isArray(p.transports) && p.transports.every((t) => typeof t === "string")
        ? { transports: p.transports }
        : {}),
    })),
  }
}

/**
 * Cryptographically verify a step-up assertion against the user's stored
 * passkeys. Consumes the single-use challenge (must be type "step-up" and bound
 * to this user), verifies the signature/origin/rpId, and advances the signature
 * counter. Returns true only on a fully verified ceremony.
 */
export async function verifyStepUpAssertion(
  db: Db,
  userId: string,
  assertion: StepUpAssertion | undefined,
  host?: string,
  forwardedProto?: string,
): Promise<boolean> {
  if (!assertion?.credential?.id || !assertion?.challenge) return false

  // Single-use: consume the challenge atomically, bound to this user + ceremony.
  const stored = await db.collection<StoredChallenge>("challenges").findOneAndDelete({
    _id: assertion.challenge,
    type: "step-up",
    userId,
    expiresAt: { $gt: new Date() },
  })
  if (!stored) return false

  const user = await db.collection<User>("users").findOne({ _id: userId as never })
  if (!user) return false

  const passkey = user.auth.passkeys.find((p) => p.id === assertion.credential.id)
  if (!passkey) return false

  const resp = assertion.credential.response
  if (!resp?.authenticatorData || !resp?.clientDataJSON || !resp?.signature) return false

  try {
    const verification = await verifyAuthenticationResponse(
      {
        response: {
          authenticatorData: base64URLDecode(resp.authenticatorData),
          clientDataJSON: base64URLDecode(resp.clientDataJSON),
          signature: base64URLDecode(resp.signature),
        },
      },
      base64URLDecode(assertion.challenge),
      passkey,
      { expectedRpId: getRP(host).id, expectedOrigin: getExpectedOrigin(host, forwardedProto) },
    )
    if (!verification.verified) return false

    // Persist the highest counter seen (matches the login path's rollback guard).
    const finalCounter = Math.max(verification.newCounter, passkey.counter)
    await db.collection<User>("users").updateOne(
      { _id: user._id, "auth.passkeys.id": passkey.id },
      { $set: { "auth.passkeys.$.counter": finalCounter, updatedAt: Date.now() } },
    )
    return true
  } catch (error) {
    console.error("[StepUp] verification error:", error)
    return false
  }
}
