/**
 * Opportunistic, self-healing passkey maintenance (server-only).
 *
 * Called fire-and-forget whenever a passkey is used (login) or added, so old
 * records carrying a malformed `transports` value get rewritten to a clean
 * shape exactly once — without a dedicated migration.
 */

import type { Db } from "mongodb"
import { sanitizePasskeyTransports } from "@/lib/auth/server/webauthn"
import type { User } from "@/lib/auth/types"

export async function normalizePasskeyTransports(db: Db, userId: string): Promise<void> {
  try {
    // Re-read fresh so we never clobber a counter update made just before this.
    // User._id is a string CUID; cast past the driver's default ObjectId typing.
    const user = await db.collection<User>("users").findOne({ _id: userId as never })
    const passkeys = user?.auth?.passkeys
    if (!passkeys || passkeys.length === 0) return

    const { cleaned, changed } = sanitizePasskeyTransports(passkeys)
    if (!changed) return

    await db
      .collection("users")
      .updateOne({ _id: userId as never }, { $set: { "auth.passkeys": cleaned } })
    console.log("[Auth] Normalized malformed passkey transports for", userId)
  } catch (error) {
    // Best-effort cleanup — never affect the auth flow that triggered it.
    console.error("[Auth] passkey transport normalization failed:", error)
  }
}
