import { type NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoClient, ensureBackfilled, SEQ_COLLECTIONS } from "@/lib/mongodb";
import { validateRequestSession } from "@/lib/auth/server/session";

const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1000;

const VALID_COLLECTIONS = new Set<string>(SEQ_COLLECTIONS);

/**
 * Delta pull. Records are paginated by a server-authored keyset cursor
 * `(serverSeq, _id)` — immune to device clock skew and the multi-instance
 * "syncedAt < serverNow" missed-pull window. Deletions are still delivered by
 * wall-clock `deletedAt` against `since`, which also drives the 30-day
 * full-resync gate.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collection: string }> }
) {
  try {
    const session = await validateRequestSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { collection } = await params;
    if (!VALID_COLLECTIONS.has(collection)) {
      return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const cursorSeq = Number.parseInt(searchParams.get("seq") || "0", 10) || 0;
    const cursorIdRaw = searchParams.get("seqId") || "";
    const since = Number.parseInt(searchParams.get("since") || "0", 10) || 0;
    const limit = Math.min(
      Math.max(Number.parseInt(searchParams.get("limit") || `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );

    const mongoClient = await getMongoClient();
    const db = mongoClient.db("skylog");
    const userId = session.userId;

    await ensureBackfilled(db, userId);

    // Full-resync gate: if the client's wall-clock tombstone watermark predates
    // tombstone retention, it may have missed deletions → require a clean resync.
    const retentionCutoff = Date.now() - TOMBSTONE_RETENTION_MS;
    if (since > 0 && since < retentionCutoff) {
      console.log("[Sync] client tombstone watermark older than retention - full resync required");
      return NextResponse.json({
        requiresFullResync: true,
        reason: "Your last sync was too long ago. A full re-sync is required.",
        records: [],
        deletions: [],
        nextCursor: { seq: 0, id: "" },
        hasMore: false,
        serverNow: Date.now(),
        count: 0,
      });
    }

    const serverNow = Date.now();

    // Build the keyset query. seq===0 && no id => first page (all docs).
    const cursorId =
      cursorIdRaw && ObjectId.isValid(cursorIdRaw) ? new ObjectId(cursorIdRaw) : null;
    const query: Record<string, unknown> = { userId };
    if (cursorSeq > 0 || cursorId) {
      query.$or = cursorId
        ? [{ serverSeq: { $gt: cursorSeq } }, { serverSeq: cursorSeq, _id: { $gt: cursorId } }]
        : [{ serverSeq: { $gt: cursorSeq } }];
    }

    const records = await db
      .collection(collection)
      .find(query)
      .sort({ serverSeq: 1, _id: 1 })
      .limit(limit)
      .toArray();

    const hasMore = records.length === limit;
    const last = records[records.length - 1];
    const nextCursor = last
      ? { seq: (last.serverSeq as number) ?? cursorSeq, id: (last._id as ObjectId).toString() }
      : { seq: cursorSeq, id: cursorIdRaw };

    // Deletions delta (wall-clock). Returned on every page; small and applied
    // idempotently on the client.
    let deletions: string[] = [];
    if (since > 0) {
      const tombstones = await db
        .collection("deletions")
        .find({ userId, collection, deletedAt: { $gt: new Date(since) } })
        .project({ recordId: 1 })
        .toArray();
      deletions = tombstones.map((t) => t.recordId);
    }

    // Lean payload: strip Mongo internals; the client normalizer fills defaults.
    const transformedRecords = records.map((record) => {
      const { _id, syncedAt, ...rest } = record;
      return { ...rest, syncStatus: "synced" };
    });

    return NextResponse.json({
      records: transformedRecords,
      deletions,
      nextCursor,
      hasMore,
      serverNow,
      count: transformedRecords.length,
    });
  } catch (error) {
    console.error("[Sync] delta pull error:", error);
    return NextResponse.json({ error: "Failed to fetch records" }, { status: 500 });
  }
}
