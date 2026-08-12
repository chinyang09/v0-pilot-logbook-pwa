/**
 * Aircraft enrichment chain — extracted from scoot-parser so all parsers can
 * reuse the same lookup pipeline:
 *
 *   1. Local IndexedDB (batchGetAircraftByRegistrations) — bulk
 *   2. Server batch (POST /api/search/aircraft/batch) — MongoDB enrichment cache
 *   3. FR24 live (GET /api/search/aircraft?q=REG) — per-reg fallback
 *
 * Results from steps 2 and 3 are written back to local IndexedDB so the next
 * import for the same registration is fully local. FR24 hits are also queued
 * for fire-and-forget submission to the server.
 */

import {
  batchGetAircraftByRegistrations,
  addCustomAircraftToDatabase,
  type NormalizedAircraft,
} from "@/lib/db/stores/reference/aircraft.store";
import { submitAircraftToServer } from "@/lib/submissions/submit";
import { normalizeRegistration } from "@/lib/utils/string";
import { pooledForEach } from "./pooled-map";
import type { AircraftRecord } from "@/types/entities/aircraft.types";

export interface EnrichProgress {
  current: number;
  total: number;
  reg: string;
  stage: "local" | "server-batch" | "fr24";
}

export interface EnrichResult {
  /** Map of original-cased input registration → normalized aircraft. */
  enriched: Map<string, NormalizedAircraft>;
  /** Registrations that no source could resolve. */
  failedRegs: string[];
  /** Counts for the import summary. */
  stats: {
    localHits: number;
    serverBatchHits: number;
    fr24Hits: number;
    failed: number;
  };
}

const normalizeReg = normalizeRegistration;

export async function enrichAircraftBatch(
  registrations: string[],
  onProgress?: (p: EnrichProgress) => void
): Promise<EnrichResult> {
  const enriched = new Map<string, NormalizedAircraft>();
  const stats = { localHits: 0, serverBatchHits: 0, fr24Hits: 0, failed: 0 };

  if (registrations.length === 0) {
    return { enriched, failedRegs: [], stats };
  }

  // UPPERCASED once, so every leg of the chain keys the result map the same
  // way. The local leg used to return the uppercased form while the server and
  // FR24 legs keyed on the raw input, leaving callers to guess which casing a
  // given hit came back under.
  const uniqueRegs = Array.from(
    new Set(registrations.map((r) => r.trim().toUpperCase()).filter(Boolean))
  );

  // ---------- 1. Local IndexedDB ----------
  const localMap = await batchGetAircraftByRegistrations(uniqueRegs);
  for (const [reg, ac] of localMap) {
    enriched.set(reg, ac);
    stats.localHits++;
  }

  let remaining = uniqueRegs.filter((reg) => !enriched.has(reg));

  // ---------- 2. Server batch (MongoDB enrichment cache) ----------
  if (remaining.length > 0) {
    try {
      const batchRes = await fetch("/api/search/aircraft/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrations: remaining }),
        signal: AbortSignal.timeout(8000),
      });

      if (batchRes.ok) {
        const { results } = await batchRes.json();
        const normalizedMap = (results || {}) as Record<
          string,
          {
            registration: string;
            typecode: string;
            icao24: string;
            operator: string;
            shortDescription: string;
            wtc: string;
            wtg: string;
            manufacturerCode: string;
          }
        >;

        for (const reg of remaining) {
          const match = normalizedMap[normalizeReg(reg)];
          if (!match) continue;

          const ac: NormalizedAircraft = {
            registration: match.registration,
            icao24: match.icao24 || "",
            typecode: match.typecode || "",
            shortDescription: match.shortDescription || "",
            wtc: match.wtc || "",
            wtg: match.wtg || "",
            manufacturerCode: match.manufacturerCode || "",
            operator: match.operator || "",
          };
          enriched.set(reg, ac);
          stats.serverBatchHits++;

          // Persist locally for next time.
          const record: AircraftRecord = {
            registration: match.registration,
            icao24: match.icao24 || "",
            typecode: match.typecode || "",
            operator: match.operator || "",
            shortDescription: match.shortDescription || "",
            wtc: match.wtc || "",
            wtg: match.wtg || "",
            manufacturerCode: match.manufacturerCode || "",
            source: "fr24",
          };
          addCustomAircraftToDatabase(record).catch(() => {});
        }
      }
    } catch {
      // Server unreachable — fall through to FR24 fallback.
    }

    remaining = remaining.filter((reg) => !enriched.has(reg));
  }

  // ---------- 3. FR24 live, per-reg ----------
  const failedRegs: string[] = [];
  if (remaining.length > 0) {
    let done = 0;
    // Bounded — a migration's worth of unresolved tails would otherwise all go
    // out at once. See `pooled-map.ts`.
    await pooledForEach(remaining, async (reg) => {
        try {
          const res = await fetch(
            `/api/search/aircraft?q=${encodeURIComponent(reg)}`,
            { signal: AbortSignal.timeout(8000) }
          );

          if (!res.ok) {
            failedRegs.push(reg);
            stats.failed++;
            return;
          }

          const data = await res.json();
          const match = data?.results?.[0];

          if (!match || !match.registration) {
            failedRegs.push(reg);
            stats.failed++;
            return;
          }

          const record: AircraftRecord = {
            registration: match.registration,
            icao24: match.icao24 || "",
            typecode: match.typecode || "",
            operator: match.operator || "",
            source: "fr24",
          };
          const submissionId = await addCustomAircraftToDatabase(record);

          enriched.set(reg, {
            registration: match.registration,
            icao24: match.icao24 || "",
            typecode: match.typecode || "",
            shortDescription: "",
            wtc: "",
            wtg: "",
            manufacturerCode: "",
            operator: match.operator || "",
          });
          stats.fr24Hits++;

          // Fire-and-forget — server enrichment shares with other users.
          submitAircraftToServer({
            submissionId,
            registration: match.registration,
            typecode: match.typecode,
            icao24: match.icao24,
            operator: match.operator,
          });
        } catch {
          failedRegs.push(reg);
          stats.failed++;
        } finally {
          done++;
          onProgress?.({
            current: done,
            total: remaining.length,
            reg,
            stage: "fr24",
          });
        }
      }
    );
  }

  return { enriched, failedRegs, stats };
}
