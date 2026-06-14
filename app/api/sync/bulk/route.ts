import { type NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import { validateSessionFromHeader } from "@/lib/auth/server/session";

interface SyncQueueItem {
  id: string;
  type: "create" | "update" | "delete";
  timestamp: number;
  collection: "flights" | "aircraft" | "personnel";
  data: any;
  retryCount?: number;
}

interface BulkSyncResult {
  queueItemId: string;
  success: boolean;
  rejected?: boolean;
  reason?: string;
}

async function checkTombstone(
  db: any,
  userId: string,
  collection: string,
  recordId: string
): Promise<boolean> {
  const tombstone = await db.collection("deletions").findOne({
    userId,
    collection,
    recordId,
  });
  return !!tombstone;
}

export async function POST(request: NextRequest) {
  try {
    const session = await validateSessionFromHeader(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { items } = await request.json();

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Invalid request: items must be a non-empty array" }, { status: 400 });
    }

    console.log(`[v0] Bulk sync: Processing ${items.length} items for user ${session.userId}`);

    const mongoClient = await getMongoClient();
    const db = mongoClient.db("skylog");

    const results: BulkSyncResult[] = [];

    // Group items by collection for efficient batch processing
    const itemsByCollection: Record<string, SyncQueueItem[]> = (items as SyncQueueItem[]).reduce((acc: Record<string, SyncQueueItem[]>, item: SyncQueueItem) => {
      if (!acc[item.collection]) {
        acc[item.collection] = [];
      }
      acc[item.collection].push(item);
      return acc;
    }, {} as Record<string, SyncQueueItem[]>);

    // Process each collection's items
    for (const [collectionName, collectionItems] of Object.entries(itemsByCollection)) {
      const coll = db.collection(collectionName);
      const bulkOps: any[] = [];
      // Queue-item id for each bulkOps entry, kept parallel so partial-failure
      // handling can map a writeError back to the right item by op index.
      const opItemIds: string[] = [];

      // Batch fetch all record IDs to check tombstones
      const recordIds = collectionItems.map(item => item.data.id);
      const tombstones = await db.collection("deletions").find({
        userId: session.userId,
        collection: collectionName,
        recordId: { $in: recordIds }
      }).toArray();
      const tombstoneSet = new Set(tombstones.map((t: any) => t.recordId));

      // Batch fetch existing records to compare timestamps
      const existingRecords = await coll.find({
        userId: session.userId,
        id: { $in: recordIds }
      }).toArray();
      const existingMap = new Map(existingRecords.map((r: any) => [r.id, r]));

      // Prepare bulk operations
      for (let i = 0; i < collectionItems.length; i++) {
        const item = collectionItems[i];

        const { syncStatus, ...dataWithoutSyncStatus } = item.data;
        const dataWithUser = {
          ...dataWithoutSyncStatus,
          userId: session.userId,
        };

        switch (item.type) {
          case "create":
          case "update":
            // Check if tombstoned
            if (tombstoneSet.has(item.data.id)) {
              console.log(`[v0] Rejecting ${item.type} for tombstoned record: ${item.data.id}`);
              results.push({
                queueItemId: item.id,
                success: false,
                rejected: true,
                reason: "Record was deleted on another device",
              });
              continue; // Skip this item
            }

            // Get existing record if any
            const existing = existingMap.get(item.data.id);

            const incomingTime = item.data.updatedAt || item.data.createdAt || Date.now();
            const existingTime = existing ? (existing.updatedAt || existing.createdAt || 0) : 0;

            // Only proceed if incoming is newer or equal
            if (incomingTime >= existingTime) {
              if (existing) {
                // Update existing. Preserve the server's original createdAt —
                // never let a client-supplied createdAt overwrite it.
                const { createdAt: _ignoredCreatedAt, ...dataWithoutCreatedAt } = dataWithUser;
                bulkOps.push({
                  updateOne: {
                    filter: { id: item.data.id, userId: session.userId },
                    update: {
                      $set: {
                        ...dataWithoutCreatedAt,
                        updatedAt: item.data.updatedAt || Date.now(),
                        syncedAt: Date.now(),
                      },
                    },
                  },
                });
              } else {
                // Insert new
                bulkOps.push({
                  insertOne: {
                    document: {
                      ...dataWithUser,
                      _id: new ObjectId(),
                      createdAt: item.data.createdAt || Date.now(),
                      updatedAt: item.data.updatedAt || Date.now(),
                      syncedAt: Date.now(),
                    },
                  },
                });
              }
              opItemIds.push(item.id);

              results.push({
                queueItemId: item.id,
                success: true,
              });
            } else {
              // Skip - server version is newer
              console.log(`[v0] Skipping ${item.type} for ${item.data.id} - server version is newer`);
              results.push({
                queueItemId: item.id,
                success: true, // Count as success but didn't update
              });
            }
            break;

          case "delete":
            bulkOps.push({
              deleteOne: {
                filter: {
                  userId: session.userId,
                  id: item.data.id,
                },
              },
            });
            opItemIds.push(item.id);

            results.push({
              queueItemId: item.id,
              success: true,
            });
            break;
        }
      }

      // Write tombstones BEFORE deleting the records. A deletion must never be
      // applied on the server without a matching tombstone, otherwise the
      // record resurrects on other devices (they never learn it was deleted).
      // A tombstone that briefly precedes its delete is harmless.
      const deleteItems = collectionItems.filter(item => item.type === "delete");
      let tombstonesOk = true;
      if (deleteItems.length > 0) {
        const tombstoneOps = deleteItems.map(item => ({
          updateOne: {
            filter: {
              userId: session.userId,
              collection: collectionName,
              recordId: item.data.id,
            },
            update: {
              $set: {
                userId: session.userId,
                collection: collectionName,
                recordId: item.data.id,
                deletedAt: new Date(),
              },
            },
            upsert: true,
          },
        }));

        try {
          await db.collection("deletions").bulkWrite(tombstoneOps, { ordered: false });
          console.log(`[v0] Created ${tombstoneOps.length} tombstones for ${collectionName}`);
        } catch (tombstoneError) {
          console.error(`[v0] Tombstone bulk write error for ${collectionName}:`, tombstoneError);
          tombstonesOk = false;
        }
      }

      // If tombstones failed, drop the delete ops so we don't delete without a
      // tombstone, and mark those items failed so the client retries them.
      let opsToRun = bulkOps;
      let opIds = opItemIds;
      if (!tombstonesOk) {
        opsToRun = [];
        opIds = [];
        for (let k = 0; k < bulkOps.length; k++) {
          if (bulkOps[k].deleteOne) {
            const resultIndex = results.findIndex(r => r.queueItemId === opItemIds[k]);
            if (resultIndex !== -1) {
              results[resultIndex] = {
                queueItemId: opItemIds[k],
                success: false,
                reason: "Tombstone write failed",
              };
            }
          } else {
            opsToRun.push(bulkOps[k]);
            opIds.push(opItemIds[k]);
          }
        }
      }

      // Execute bulk operations if any
      if (opsToRun.length > 0) {
        try {
          const bulkResult = await coll.bulkWrite(opsToRun, { ordered: false });
          console.log(`[v0] Bulk write for ${collectionName}: inserted ${bulkResult.insertedCount}, updated ${bulkResult.modifiedCount}, deleted ${bulkResult.deletedCount}`);
        } catch (bulkError: any) {
          console.error(`[v0] Bulk write error for ${collectionName}:`, bulkError);

          // Handle partial failures — writeError.index is the position in the
          // ops array we passed to bulkWrite, mapped back via opIds.
          if (bulkError.writeErrors) {
            for (const writeError of bulkError.writeErrors) {
              const failedId = opIds[writeError.index];
              if (failedId) {
                const resultIndex = results.findIndex(r => r.queueItemId === failedId);
                if (resultIndex !== -1) {
                  results[resultIndex] = {
                    queueItemId: failedId,
                    success: false,
                    reason: writeError.errmsg || "Write error",
                  };
                }
              }
            }
          }
        }
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    console.log(`[v0] Bulk sync complete: ${successCount} succeeded, ${failedCount} failed`);

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: items.length,
        succeeded: successCount,
        failed: failedCount,
      },
    });
  } catch (error) {
    console.error("[v0] Bulk sync error:", error);
    return NextResponse.json(
      { error: "Bulk sync failed" },
      { status: 500 }
    );
  }
}
