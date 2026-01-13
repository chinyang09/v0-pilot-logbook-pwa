import { type NextRequest, NextResponse } from "next/server";
import { getMongoClient } from "@/lib/mongodb";
import { validateSessionFromHeader } from "@/lib/auth/server/session";

const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collection: string }> }
) {
  try {
    const session = await validateSessionFromHeader(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { collection } = await params;
    const { searchParams } = new URL(request.url);
    const since = Number.parseInt(searchParams.get("since") || "0");

    const validCollections = ["flights", "aircraft", "personnel"];
    if (!validCollections.includes(collection)) {
      return NextResponse.json(
        { error: "Invalid collection" },
        { status: 400 }
      );
    }

    const mongoClient = await getMongoClient();
    const db = mongoClient.db("skylog");

    const tombstoneRetentionCutoff = Date.now() - TOMBSTONE_RETENTION_MS;
    if (since > 0 && since < tombstoneRetentionCutoff) {
      console.log(
        "[v0] Client lastSyncTime is older than tombstone retention - requiring full resync"
      );
      return NextResponse.json({
        requiresFullResync: true,
        reason: "Your last sync was too long ago. A full re-sync is required.",
        records: [],
        deletions: [],
        syncedAt: Date.now(),
        count: 0,
      });
    }

    const query: Record<string, unknown> = { userId: session.userId };
    if (since > 0) {
      query.$or = [
        { updatedAt: { $gt: since } },
        { createdAt: { $gt: since } },
        { syncedAt: { $gt: since } },
      ];
    }

    const sortCriteria =
      collection === "flights"
        ? { date: -1, updatedAt: -1, createdAt: -1 }
        : { updatedAt: -1, createdAt: -1 };

    const records = await db
      .collection(collection)
      .find(query)
      .sort(sortCriteria)
      .toArray();

    let deletions: string[] = [];
    if (since > 0) {
      const tombstones = await db
        .collection("deletions")
        .find({
          userId: session.userId,
          collection,
          deletedAt: { $gt: new Date(since) },
        })
        .toArray();

      deletions = tombstones.map((t) => t.recordId);
      console.log(
        `[v0] Found ${
          deletions.length
        } deletions for ${collection} since ${new Date(since).toISOString()}`
      );
    }

    const transformedRecords = records.map((record) => {
      const { _id, syncedAt, ...rest } = record;

      // Create base record
      const transformed: Record<string, unknown> = {
        ...rest,
        syncStatus: "synced",
      };

      if (collection === "flights") {
        // Ensure HH:MM time fields default to "00:00" if missing
        const timeFields = [
          "blockTime",
          "flightTime",
          "nightTime",
          "dayTime",
          "picTime",
          "sicTime",
          "picusTime",
          "dualTime",
          "instructorTime",
          "ifrTime",
          "actualInstrumentTime",
          "simulatedInstrumentTime",
          "crossCountryTime",
        ];
        for (const field of timeFields) {
          if (!transformed[field]) {
            transformed[field] = "00:00";
          }
        }

        // Ensure number fields default to 0
        const numberFields = [
          "dayTakeoffs",
          "dayLandings",
          "nightTakeoffs",
          "nightLandings",
          "autolands",
          "holds",
        ];
        for (const field of numberFields) {
          if (typeof transformed[field] !== "number") {
            transformed[field] = Number(transformed[field]) || 0;
          }
        }

        // Ensure string fields exist
        const stringFields = [
          "flightNumber",
          "aircraftReg",
          "aircraftType",
          "departureIcao",
          "departureIata",
          "arrivalIcao",
          "arrivalIata",
          "scheduledOut",
          "scheduledIn",
          "outTime",
          "offTime",
          "onTime",
          "inTime",
          "picId",
          "picName",
          "sicId",
          "sicName",
          "remarks",
          "endorsements",
        ];
        for (const field of stringFields) {
          if (!transformed[field]) {
            transformed[field] = "";
          }
        }

        // Ensure pilotRole has valid default
        if (!transformed.pilotRole) {
          transformed.pilotRole = "SIC";
        }

        // Ensure manualOverrides object exists
        if (!transformed.manualOverrides) {
          transformed.manualOverrides = {};
        }

        // Ensure array fields
        if (!Array.isArray(transformed.approaches)) {
          transformed.approaches = [];
        }
        if (!Array.isArray(transformed.additionalCrew)) {
          transformed.additionalCrew = [];
        }

        // Ensure boolean fields
        if (typeof transformed.ipcIcc !== "boolean") {
          transformed.ipcIcc = false;
        }
        if (typeof transformed.isLocked !== "boolean") {
          transformed.isLocked = false;
        }
        if (typeof transformed.isDraft !== "boolean") {
          transformed.isDraft = false;
        }
        if (typeof transformed.pilotFlying !== "boolean") {
          transformed.pilotFlying = true;
        }
      }

      return transformed;
    });

    return NextResponse.json({
      records: transformedRecords,
      deletions, // Include deletions array in response
      syncedAt: Date.now(),
      count: transformedRecords.length,
    });
  } catch (error) {
    console.error("Fetch collection error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch records",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
