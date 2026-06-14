import { type NextRequest, NextResponse } from "next/server";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { getMongoClient, reserveSeqBlock, ensureBackfilled, SEQ_COLLECTIONS } from "@/lib/mongodb";
import { validateSessionFromHeader } from "@/lib/auth/server/session";

interface SyncQueueItem {
  id: string;
  type: "create" | "update" | "delete";
  timestamp: number;
  collection: string;
  data: Record<string, unknown> & { id?: string };
  retryCount?: number;
}

interface BulkSyncResult {
  queueItemId: string;
  success: boolean;
  rejected?: boolean;
  reason?: string;
}

// Abuse / payload guards. An authenticated client should never legitimately
// push more than a few hundred compacted ops at once.
const MAX_ITEMS = 2000;

const VALID_COLLECTIONS = new Set<string>(SEQ_COLLECTIONS);

/** Coerce a value to a finite number, else undefined (kills LWW type-confusion). */
function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/**
 * Deterministic authorship tuple comparison: (updatedAt|createdAt, deviceId).
 * Returns > 0 if `a` strictly wins, < 0 if `b` wins, 0 if identical authorship.
 */
function compareAuthorship(
  aT: number,
  aD: string,
  bT: number,
  bD: string
): number {
  if (aT !== bT) return aT - bT;
  return aD < bD ? -1 : aD > bD ? 1 : 0;
}

type PlannedAction =
  | { kind: "write"; item: SyncQueueItem; isInsert: boolean }
  | { kind: "delete"; item: SyncQueueItem }
  | { kind: "skip"; item: SyncQueueItem } // server version is newer-or-equal
  | { kind: "rejected"; item: SyncQueueItem };

export async function POST(request: NextRequest) {
  try {
    const session = await validateSessionFromHeader(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const items = (body as { items?: unknown })?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Invalid request: items must be a non-empty array" },
        { status: 400 }
      );
    }
    if (items.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `Too many items (max ${MAX_ITEMS})` },
        { status: 413 }
      );
    }

    const userId = session.userId;
    console.log(`[Sync] bulk push: ${items.length} items for user ${userId}`);

    const mongoClient = await getMongoClient();
    const db = mongoClient.db("skylog");

    // One-time per-user backfill so all existing docs carry a serverSeq and the
    // counter sits above them — required before we assign new serverSeq values.
    await ensureBackfilled(db, userId);

    const results: BulkSyncResult[] = [];

    // Validate + bucket by collection. Invalid items are poison → reported
    // failed (client dead-letters them) rather than silently dropped.
    const itemsByCollection: Record<string, SyncQueueItem[]> = {};
    for (const raw of items as SyncQueueItem[]) {
      if (
        !raw ||
        typeof raw.id !== "string" ||
        !VALID_COLLECTIONS.has(raw.collection) ||
        !raw.data ||
        typeof raw.data.id !== "string"
      ) {
        results.push({
          queueItemId: (raw as { id?: string })?.id ?? "unknown",
          success: false,
          reason: "Invalid sync item",
        });
        continue;
      }
      (itemsByCollection[raw.collection] ||= []).push(raw);
    }

    // Process dependency-light collections before flights so a flight never
    // lands referencing an aircraft/crew the server hasn't seen.
    const order = [
      "aircraft",
      "personnel",
      "scheduleEntries",
      "currencies",
      "discrepancies",
      "flights",
    ];
    const presentCollections = order.filter((c) => itemsByCollection[c]?.length);

    for (const collectionName of presentCollections) {
      const collectionItems = itemsByCollection[collectionName];
      const collResults = await processCollection(
        mongoClient,
        db,
        userId,
        collectionName,
        collectionItems
      );
      results.push(...collResults);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;
    console.log(`[Sync] bulk push complete: ${succeeded} ok, ${failed} failed`);

    return NextResponse.json({
      success: true,
      results,
      summary: { total: items.length, succeeded, failed },
    });
  } catch (error) {
    console.error("[Sync] bulk push error:", error);
    return NextResponse.json({ error: "Bulk sync failed" }, { status: 500 });
  }
}

/**
 * Process one collection's items inside a single MongoDB transaction. Results
 * are only finalized as success AFTER the transaction commits — if the write
 * throws (connection drop, etc.), every item is reported failed so the client
 * retries instead of clearing its queue (the previous silent-loss bug).
 */
async function processCollection(
  mongoClient: Awaited<ReturnType<typeof getMongoClient>>,
  db: ReturnType<Awaited<ReturnType<typeof getMongoClient>>["db"]>,
  userId: string,
  collectionName: string,
  items: SyncQueueItem[]
): Promise<BulkSyncResult[]> {
  const coll = db.collection(collectionName);
  const recordIds = items.map((i) => i.data.id as string);

  let results: BulkSyncResult[] = [];
  const session = mongoClient.startSession();

  try {
    await session.withTransaction(async () => {
      // Reset on every (possibly retried) transaction attempt.
      results = [];

      const tombstones = await db
        .collection("deletions")
        .find(
          { userId, collection: collectionName, recordId: { $in: recordIds } },
          { session }
        )
        .toArray();
      const tombstoneSet = new Set(tombstones.map((t) => t.recordId));

      const existingRecords = await coll
        .find({ userId, id: { $in: recordIds } }, { session })
        .toArray();
      const existingMap = new Map(existingRecords.map((r) => [r.id, r]));

      // Plan each item; count accepted writes so we can reserve a seq block.
      const plan: PlannedAction[] = [];
      let acceptCount = 0;

      for (const item of items) {
        if (item.type === "delete") {
          plan.push({ kind: "delete", item });
          continue;
        }

        // create / update
        if (tombstoneSet.has(item.data.id as string)) {
          plan.push({ kind: "rejected", item });
          continue;
        }

        const existing = existingMap.get(item.data.id as string) as
          | { updatedAt?: unknown; createdAt?: unknown; deviceId?: unknown }
          | undefined;

        const incT = toNum(item.data.updatedAt) ?? toNum(item.data.createdAt) ?? Date.now();
        const incD = typeof item.data.deviceId === "string" ? item.data.deviceId : "";

        if (!existing) {
          plan.push({ kind: "write", item, isInsert: true });
          acceptCount++;
        } else {
          const exT = toNum(existing.updatedAt) ?? toNum(existing.createdAt) ?? 0;
          const exD = typeof existing.deviceId === "string" ? existing.deviceId : "";
          if (compareAuthorship(incT, incD, exT, exD) > 0) {
            plan.push({ kind: "write", item, isInsert: false });
            acceptCount++;
          } else {
            // Server version is newer-or-equal — skip but report success.
            plan.push({ kind: "skip", item });
          }
        }
      }

      // Reserve a contiguous serverSeq block for the accepted writes.
      let nextSeq = acceptCount > 0 ? await reserveSeqBlock(db, userId, acceptCount, session) : 0;
      const now = Date.now();

      const dataOps: AnyBulkWriteOperation[] = [];
      const tombstoneOps: AnyBulkWriteOperation[] = [];

      for (const p of plan) {
        if (p.kind === "write") {
          const { id } = p.item.data as { id: string };
          // Strip server-controlled / transient fields; coerce timestamps.
          const {
            _id: _ignoredId,
            syncStatus: _ignoredStatus,
            serverSeq: _ignoredSeq,
            createdAt: rawCreatedAt,
            updatedAt: rawUpdatedAt,
            ...rest
          } = p.item.data as Record<string, unknown>;
          const serverSeq = nextSeq++;
          const deviceId =
            typeof p.item.data.deviceId === "string" ? p.item.data.deviceId : undefined;

          if (p.isInsert) {
            dataOps.push({
              insertOne: {
                document: {
                  ...rest,
                  userId,
                  _id: new ObjectId(),
                  createdAt: toNum(rawCreatedAt) ?? now,
                  updatedAt: toNum(rawUpdatedAt) ?? now,
                  deviceId,
                  serverSeq,
                  syncedAt: now,
                },
              },
            });
          } else {
            // `rest` already excludes createdAt, so the server's original
            // createdAt is preserved (never overwritten by a client value).
            dataOps.push({
              updateOne: {
                filter: { id, userId },
                update: {
                  $set: {
                    ...rest,
                    updatedAt: toNum(rawUpdatedAt) ?? now,
                    deviceId,
                    serverSeq,
                    syncedAt: now,
                  },
                },
              },
            });
          }
          results.push({ queueItemId: p.item.id, success: true });
        } else if (p.kind === "delete") {
          const { id } = p.item.data as { id: string };
          // Tombstone-before-delete is guaranteed atomically by the transaction.
          tombstoneOps.push({
            updateOne: {
              filter: { userId, collection: collectionName, recordId: id },
              update: {
                $set: {
                  userId,
                  collection: collectionName,
                  recordId: id,
                  deletedAt: new Date(),
                },
              },
              upsert: true,
            },
          });
          dataOps.push({ deleteOne: { filter: { userId, id } } });
          results.push({ queueItemId: p.item.id, success: true });
        } else if (p.kind === "rejected") {
          results.push({
            queueItemId: p.item.id,
            success: true,
            rejected: true,
            reason: "Record was deleted on another device",
          });
        } else {
          // skip — server version is newer; count as success, no write.
          results.push({ queueItemId: p.item.id, success: true });
        }
      }

      if (tombstoneOps.length > 0) {
        await db.collection("deletions").bulkWrite(tombstoneOps, { session, ordered: false });
      }
      if (dataOps.length > 0) {
        await coll.bulkWrite(dataOps, { session, ordered: false });
      }
    });

    return results;
  } catch (err) {
    console.error(`[Sync] transaction failed for ${collectionName}:`, err);
    // Confirm-after-write: nothing committed → report ALL items failed so the
    // client retries. Never report success on an uncommitted/failed write.
    return items.map((i) => ({
      queueItemId: i.id,
      success: false,
      reason: "Write transaction failed",
    }));
  } finally {
    await session.endSession();
  }
}
