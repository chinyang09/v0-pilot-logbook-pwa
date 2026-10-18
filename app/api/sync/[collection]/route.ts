import { type NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import { validateRequestSession } from "@/lib/auth/server/session";
import { isSyncCollection, toWireRecord } from "@/lib/sync/schema";
import {
  SYNC_DB,
  keysetQuery,
  needsFullResync,
  prepareUser,
  sanitizeCursor,
} from "@/lib/sync/server/engine";

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1000;

/**
 * LEGACY per-collection delta pull — kept for an installed PWA still running a
 * build from before `/api/sync`, which pulls every collection in one request.
 *
 * Records are paginated by the server-authored keyset cursor
 * `(serverSeq, _id)`. Deletions are delivered by wall-clock `deletedAt`
 * against `since`, which also drives the 30-day full-resync gate. Records go
 * out through `toWireRecord`, so an old build sees the same shape it always
 * has even though the stored document is now canonical.
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
    if (!isSyncCollection(collection)) {
      return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const cursor = sanitizeCursor({
      seq: Number.parseInt(searchParams.get("seq") || "0", 10) || 0,
      id: searchParams.get("seqId") || "",
    });
    const since = Number.parseInt(searchParams.get("since") || "0", 10) || 0;
    const limit = Math.min(
      Math.max(Number.parseInt(searchParams.get("limit") || `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );

    const mongoClient = await getMongoClient();
    const db = mongoClient.db(SYNC_DB);
    const userId = session.userId;
    await prepareUser(mongoClient, db, userId);

    if (needsFullResync(since)) {
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
    const records = await db
      .collection(collection)
      .find(keysetQuery(userId, cursor))
      .sort({ serverSeq: 1, _id: 1 })
      .limit(limit)
      .toArray();

    const hasMore = records.length === limit;
    const last = records[records.length - 1];
    const nextCursor = last
      ? { seq: (last.serverSeq as number) ?? cursor.seq, id: (last._id as ObjectId).toString() }
      : cursor;

    let deletions: string[] = [];
    if (since > 0) {
      const tombstones = await db
        .collection("deletions")
        .find({ userId, collection, deletedAt: { $gt: new Date(since) } })
        .project({ recordId: 1 })
        .toArray();
      deletions = tombstones.map((t) => t.recordId);
    }

    const transformedRecords = records.map((record) => toWireRecord(record));

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
