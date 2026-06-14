/**
 * Server-authored monotonic sequence counters (SERVER-ONLY)
 *
 * Each user has a single counter document in the `counters` collection
 * (`{ _id: userId, seq, backfillState }`). Every accepted write in
 * `/api/sync/bulk` is stamped with a strictly-increasing `serverSeq` reserved
 * from this counter. The delta-pull endpoint then drives its cursor off
 * `serverSeq` instead of a wall clock, which removes device-clock skew and the
 * multi-instance "syncedAt < serverNow" missed-pull window entirely.
 */

import type { Db, ClientSession } from "mongodb";

/** Collections that participate in server-authored sequencing. */
export const SEQ_COLLECTIONS = ["flights", "aircraft", "personnel"] as const;

const COUNTERS = "counters";

/**
 * Reserve a contiguous block of `count` sequence numbers for a user and return
 * the FIRST value of the block. The caller assigns block[0..count-1]
 * sequentially. Atomic via `$inc`; safe under concurrency (blocks never
 * overlap). Runs inside the caller's transaction session when provided.
 */
export async function reserveSeqBlock(
  db: Db,
  userId: string,
  count: number,
  session?: ClientSession
): Promise<number> {
  if (count <= 0) return 0;
  const doc = await db.collection(COUNTERS).findOneAndUpdate(
    { _id: userId as unknown as object },
    { $inc: { seq: count } },
    { upsert: true, returnDocument: "after", session }
  );
  // Driver v6 returns the updated document directly (or null on some paths).
  const total = (doc as { seq?: number } | null)?.seq ?? count;
  return total - count + 1;
}

/**
 * One-time, idempotent per-user backfill: assign `serverSeq` to any pre-existing
 * documents that predate the sequencing scheme, derived from their existing
 * `syncedAt`/`createdAt` so ordering is preserved, then advance the counter past
 * the highest assigned value so future reservations stay monotonic above them.
 *
 * Idempotent and concurrency-safe: the `updateMany` only touches docs missing
 * `serverSeq`, and `$max` never lowers the counter. Cheap after the first run
 * (the guard short-circuits once `backfillState === "done"`).
 */
export async function ensureBackfilled(db: Db, userId: string): Promise<void> {
  const counter = await db
    .collection(COUNTERS)
    .findOne({ _id: userId as unknown as object });
  if (counter?.backfillState === "done") return;

  // Ensure a counter doc exists (seq defaults to 0 on insert).
  await db.collection(COUNTERS).updateOne(
    { _id: userId as unknown as object },
    { $setOnInsert: { seq: 0 }, $set: { backfillState: "running" } },
    { upsert: true }
  );

  let maxSeq = 0;
  for (const coll of SEQ_COLLECTIONS) {
    // Assign serverSeq = syncedAt || createdAt || 0 to legacy docs (single op).
    await db.collection(coll).updateMany(
      { userId, serverSeq: { $exists: false } },
      [
        {
          $set: {
            serverSeq: {
              $ifNull: ["$syncedAt", { $ifNull: ["$createdAt", 0] }],
            },
          },
        },
      ]
    );
    // Track the highest assigned value so the counter can be advanced past it.
    const top = await db
      .collection(coll)
      .find({ userId })
      .sort({ serverSeq: -1 })
      .limit(1)
      .project({ serverSeq: 1 })
      .toArray();
    const topSeq = (top[0]?.serverSeq as number) || 0;
    if (topSeq > maxSeq) maxSeq = topSeq;
  }

  await db.collection(COUNTERS).updateOne(
    { _id: userId as unknown as object },
    { $max: { seq: maxSeq }, $set: { backfillState: "done" } }
  );
}
