"use client"

/**
 * Discrepancies — where the pilot's record and the company's report disagree.
 *
 * The page leads with COMPARISONS: PF/PM and the day/night takeoff-landing
 * split, rendered as flight cards with both values side by side, because those
 * are the pilot's own account of the sector and a licence submission is
 * checked against them. Either side can be taken at any time, so this is also
 * where an import decision gets undone — independently of whether the change
 * was accepted or rejected when the report was imported.
 *
 * Everything else the importer records (duplicates, stale reports, missing
 * sectors) is a one-off note rather than a standing comparison, so it sits
 * below in a compact list.
 */

import { useState, useMemo, useCallback } from "react"
import { useSessionState } from "@/hooks/use-session-state"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { FilterChips } from "@/components/ui/filter-chips"
import { RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { LIST_ITEM_TRANSITION } from "@/lib/motion"
import { useDiscrepancies, useFlights } from "@/hooks/data"
import { DiscrepancyCard, DiscrepancyResolutionDialog } from "@/components/roster"
import {
  FlightMismatchCard,
  groupMismatches,
} from "@/components/roster/flight-mismatch-card"
import { usePreferences } from "@/components/providers/preferences-provider"
import { updateFlight } from "@/lib/db"
import type { Discrepancy } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"
import { cn } from "@/lib/utils"

type FilterType = "comparisons" | "notes" | "resolved"

/** Discrepancy types that are a standing pilot-vs-company comparison. */
const MISMATCH_TYPES = new Set(["pilot_flying_mismatch", "day_night_mismatch"])

/** Fields stored as numbers, so a taken value goes back as one. */
const NUMERIC_FIELDS = new Set([
  "dayTakeoffs",
  "nightTakeoffs",
  "dayLandings",
  "nightLandings",
])

function coerce(field: string, value: string): string | number | boolean {
  if (NUMERIC_FIELDS.has(field)) return Number(value) || 0
  if (field === "pilotFlying") return value === "true"
  return value
}

export default function DiscrepanciesPage() {
  const { discrepancies, isLoading, refresh } = useDiscrepancies()
  const { flights } = useFlights()
  const { preferences } = usePreferences()
  const [filterType, setFilterType] = useSessionState<FilterType>(
    "discrepancies:filter",
    "comparisons"
  )
  const [discrepancyToResolve, setDiscrepancyToResolve] =
    useState<Discrepancy | null>(null)

  const flightsById = useMemo(() => {
    const map = new Map<string, FlightLog>()
    for (const f of flights) map.set(f.id, f)
    return map
  }, [flights])

  const mismatches = useMemo(
    () =>
      discrepancies.filter(
        (d) => MISMATCH_TYPES.has(d.type) && !d.resolved
      ),
    [discrepancies]
  )
  const notes = useMemo(
    () =>
      discrepancies
        .filter((d) => !MISMATCH_TYPES.has(d.type) && !d.resolved)
        .sort((a, b) => b.createdAt - a.createdAt),
    [discrepancies]
  )
  const resolved = useMemo(
    () =>
      discrepancies
        .filter((d) => d.resolved)
        .sort((a, b) => b.createdAt - a.createdAt),
    [discrepancies]
  )

  const groups = useMemo(
    () => groupMismatches(mismatches, flightsById),
    [mismatches, flightsById]
  )

  /**
   * Take one side of a comparison: write the value onto the flight and record
   * which side it now holds. Nothing is deleted — the other value stays on the
   * row, so the decision can be flipped back at any time.
   */
  const handleHoldingChange = useCallback(
    async (row: Discrepancy, holding: "logbook" | "schedule") => {
      const value =
        holding === "schedule" ? row.scheduleValue : row.logbookValue
      if (!row.flightLogId || !row.field || value === undefined) return

      await updateFlight(row.flightLogId, {
        [row.field]: coerce(row.field, value),
      } as Partial<FlightLog>)

      const { userDb } = await import("@/lib/db")
      await userDb.discrepancies.put({
        ...row,
        holding,
        updatedAt: Date.now(),
      })
      await refresh()
    },
    [refresh]
  )

  const discrepancyActions = useMemo(
    () => (
      <GlassIconButton
        ariaLabel="Refresh discrepancies"
        onClick={() => refresh()}
        disabled={isLoading}
      >
        <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
      </GlassIconButton>
    ),
    [refresh, isLoading]
  )

  useRegisterMainActions(discrepancyActions, true)

  const showing =
    filterType === "comparisons"
      ? groups.length
      : filterType === "notes"
        ? notes.length
        : resolved.length

  return (
    <PageContainer>
      <div className="px-4 pt-4 pb-safe space-y-4">
        <FilterChips<FilterType>
          value={filterType}
          onChange={setFilterType}
          options={[
            {
              value: "comparisons",
              label: "Comparisons",
              count: groups.length,
            },
            { value: "notes", label: "Notes", count: notes.length },
            { value: "resolved", label: "Resolved", count: resolved.length },
          ]}
        />

        {isLoading && discrepancies.length === 0 && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        )}

        {filterType === "comparisons" && groups.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              Where your entry and the company report differ. Tap a side to put
              it on record — you can switch back at any time.
            </p>
            <div className="space-y-3">
              <AnimatePresence initial={false} mode="popLayout">
                {groups.map((group) => (
                  <motion.div
                    key={group.flight.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={LIST_ITEM_TRANSITION}
                  >
                    <FlightMismatchCard
                      group={group}
                      displayPrefs={preferences.display}
                      onHoldingChange={handleHoldingChange}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </>
        )}

        {(filterType === "notes" || filterType === "resolved") && (
          <div className="space-y-3">
            <AnimatePresence initial={false} mode="popLayout">
              {(filterType === "notes" ? notes : resolved).map(
                (discrepancy) => (
                  <motion.div
                    key={discrepancy.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={LIST_ITEM_TRANSITION}
                  >
                    <DiscrepancyCard
                      discrepancy={discrepancy}
                      onResolve={(d) => setDiscrepancyToResolve(d)}
                      onReopen={async (d) => {
                        const { unresolveDiscrepancy } = await import("@/lib/db")
                        await unresolveDiscrepancy(d.id)
                        await refresh()
                      }}
                    />
                  </motion.div>
                )
              )}
            </AnimatePresence>
          </div>
        )}

        {showing === 0 && !isLoading && (
          <EmptyState
            icon={filterType === "comparisons" ? CheckCircle2 : AlertCircle}
            iconClassName={
              filterType === "comparisons" ? "text-status-valid/60" : undefined
            }
            title={
              filterType === "comparisons"
                ? "Nothing to compare"
                : filterType === "notes"
                  ? "No notes"
                  : "Nothing resolved yet"
            }
            description={
              filterType === "comparisons"
                ? "Your pilot-flying and day/night entries match every report imported so far."
                : filterType === "notes"
                  ? "Duplicates, skipped reports and missing sectors show up here after an import."
                  : "Notes you have marked as handled will be listed here."
            }
          />
        )}
      </div>

      <DiscrepancyResolutionDialog
        open={!!discrepancyToResolve}
        onOpenChange={(open) => !open && setDiscrepancyToResolve(null)}
        discrepancy={discrepancyToResolve}
        onResolved={refresh}
      />
    </PageContainer>
  )
}
