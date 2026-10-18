import { type NextRequest, NextResponse } from "next/server";
import { getMongoClient } from "@/lib/mongodb";
import { validateRequestSession, assertSameOrigin } from "@/lib/auth/server/session";
import { writeMode } from "@/lib/sync/schema";
import { validatePushItems } from "@/lib/sync/server/plan";
import { SYNC_DB, applyPush, prepareUser } from "@/lib/sync/server/engine";

/**
 * LEGACY push endpoint — kept for an installed PWA still running a build from
 * before `/api/sync`. It goes through the same engine, so its writes land in
 * the canonical document shape too. An old build does not declare a schema
 * version, so its payload is MERGED over the stored document (the `$set`
 * behaviour it was written against) rather than replacing it — it may not
 * know about fields a newer device has written.
 */

// Abuse / payload guard. An authenticated client should never legitimately
// push more than a few hundred compacted ops at once.
const MAX_ITEMS = 2000;

export async function POST(request: NextRequest) {
  try {
    if (!assertSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }
    const session = await validateRequestSession(request);
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
      return NextResponse.json({ error: `Too many items (max ${MAX_ITEMS})` }, { status: 413 });
    }

    const userId = session.userId;
    const client = await getMongoClient();
    const db = client.db(SYNC_DB);
    await prepareUser(client, db, userId);

    const { byCollection, invalid } = validatePushItems(items);
    const { results } = await applyPush(
      client,
      db,
      userId,
      byCollection,
      writeMode((body as { schemaVersion?: unknown }).schemaVersion)
    );
    const all = [...invalid, ...results];

    const succeeded = all.filter((r) => r.success).length;
    return NextResponse.json({
      success: true,
      results: all,
      summary: { total: items.length, succeeded, failed: all.length - succeeded },
    });
  } catch (error) {
    console.error("[Sync] bulk push error:", error);
    return NextResponse.json({ error: "Bulk sync failed" }, { status: 500 });
  }
}
