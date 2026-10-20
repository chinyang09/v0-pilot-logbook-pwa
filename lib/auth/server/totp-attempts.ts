import type { Db, Filter, Document } from "mongodb"

/**
 * The two TOTP bookkeeping writes, each ONE atomic database operation.
 *
 * Both used to be read-then-write: the route read the fail count or the last
 * accepted time-step off the user it had loaded, decided, and wrote the result
 * back. Requests in parallel all read the same values, so
 *
 * - every concurrent wrong guess wrote the same `count + 1` and the lockout
 *   never tripped, however many guesses were sent, and
 * - two requests carrying the same valid code both passed the replay check,
 *   and both were honoured.
 *
 * Here the database does the deciding: `$inc` counts every failure, and a
 * conditional update lets exactly one request claim a time-step.
 */

export const MAX_TOTP_ATTEMPTS = 5
export const TOTP_LOCKOUT_MS = 15 * 60 * 1000

/** The user document's `_id`, whichever type the caller holds it as. */
type UserId = unknown
const byId = (userId: UserId, extra: Filter<Document> = {}): Filter<Document> => ({ _id: userId, ...extra }) as Filter<Document>

/** Count a wrong code; locks the account's TOTP once the limit is reached. */
export async function recordTotpFailure(db: Db, userId: UserId, now = Date.now()): Promise<void> {
  const users = db.collection("users")
  const after = await users.findOneAndUpdate(
    byId(userId),
    { $inc: { "auth.totpFailCount": 1 } },
    { returnDocument: "after", projection: { "auth.totpFailCount": 1 } }
  )
  const count = (after?.auth as { totpFailCount?: number } | undefined)?.totpFailCount ?? 0
  if (count >= MAX_TOTP_ATTEMPTS) {
    await users.updateOne(
      byId(userId, { "auth.totpFailCount": { $gte: MAX_TOTP_ATTEMPTS } }),
      { $set: { "auth.totpFailCount": 0, "auth.totpLockUntil": now + TOTP_LOCKOUT_MS } }
    )
  }
}

/**
 * Claim a verified code's time-step. True for exactly ONE caller per step:
 * the update only matches while the stored step is still below it.
 */
export async function claimTotpCounter(
  db: Db,
  userId: UserId,
  counter: number,
  { clearFailures = false }: { clearFailures?: boolean } = {}
): Promise<boolean> {
  const result = await db.collection("users").updateOne(
    byId(userId, {
      $or: [{ "auth.lastTotpCounter": { $lt: counter } }, { "auth.lastTotpCounter": { $exists: false } }],
    }),
    {
      $set: { "auth.lastTotpCounter": counter },
      ...(clearFailures ? { $unset: { "auth.totpFailCount": "", "auth.totpLockUntil": "" } } : {}),
    }
  )
  return result.modifiedCount === 1
}
