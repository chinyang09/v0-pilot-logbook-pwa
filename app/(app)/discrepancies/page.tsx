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
 * A comparison the user settles in the company's favour stops being a standing
 * difference: their value is gone from the flight and the only thing left is
 * whether they want it back. Those move to ACCEPTED, where each card shows the
 * time left on its 90-day undo window (`lib/utils/retention.ts`). When the
 * window closes the row is purged — which is the moment the original value
 * really is unrecoverable, so the countdown is shown rather than implied.
 * Comparisons the user keeps in their own favour never expire; there is
 * nothing to expire, and the standing difference is the licence record.
 *
 * Everything else the importer records (duplicates, stale reports, missing
 * sectors) is a one-off note rather than a standing comparison, so it sits
 * below in a compact list.
 */

import { useState, useMemo, useCallback, useEffect } from "react"
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
import {
  updateFlight,
  setDiscrepancyHolding,
  purgeExpiredAcceptedDiscrepancies,
} from "@/lib/db"
import type { Discrepancy } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"
import { cn } from "@/lib/utils"

/**
 * Three tabs, not four. The page holds two kinds of thing, each with an open
 * and a settled state:
 *
 *   a tracked field difference → Comparisons (standing) / Accepted (conceded)
 *   a one-off import note      → Notes, with the handled ones below the open
 *
 * Giving the notes' settled state its own tab called "Resolved" put two
 * synonyms in the tab bar next to each other and made the split look arbitrary.
 */
const TABS = ["comparisons", "accepted", "notes"] as const
type FilterType = (typeof TABS)[number]

/** Discrepancy types that are a standing pilot-vs-company comparison. */
const MISMATCH_TYPES = new Set(["pilot_flying_mismatch", "day_night_mismatch"])

/** Fields stored as numbers, so a taken value goes back as one. */
const NUMERIC_FIELDS = new Set([
  "dayTakeoffs",
  "nightTakeoffs",
  "dayLandings",
  "nightLandings",
])

const EMPTY_STATES: Record<FilterType, { title: string; description: string }> = {
  comparisons: {
    title: "Nothing to compare",
    description:
      "Your pilot-flying and day/night entries match every report imported so far.",
  },
  accepted: {
    title: "Nothing accepted",
    description:
      "When you take the company's figure over your own, it stays here for 90 days so you can put yours back.",
  },
  notes: {
    title: "No notes",
    description:
      "Duplicates, skipped reports and missing sectors show up here after an import.",
  },
}

function coerce(field: string, value: string): string | number | boolean {
  if (NUMERIC_FIELDS.has(field)) return Number(value) || 0
  if (field === "pilotFlying") return value === "true"
  return value
}

export default function DiscrepanciesPage() {
  const { discrepancies, isLoading, refresh } = useDiscrepancies()
  const { flights } = useFlights()
  const { preferences } = usePreferences()
  const [storedFilter, setFilterType] = useSessionState<FilterType>(
    "discrepancies:filter",
    "comparisons"
  )
  // A session open across the deploy that dropped the "Resolved" tab still has
  // it in sessionStorage; without this the page comes back on a tab that no
  // longer renders anything.
  const filterType: FilterType = TABS.includes(storedFilter)
    ? storedFilter
    : "comparisons"
  const [discrepancyToResolve, setDiscrepancyToResolve] =
    useState<Discrepancy | null>(null)

  const flightsById = useMemo(() => {
    const map = new Map<string, FlightLog>()
    for (const f of flights) map.set(f.id, f)
    return map
  }, [flights])

  // A comparison the user has settled the company's way is no longer a
  // difference to weigh, only a change to keep undoable — so the two lists are
  // split on which side the row holds rather than on `resolved`.
  const mismatches = useMemo(
    () =>
      discrepancies.filter(
        (d) => MISMATCH_TYPES.has(d.type) && !d.resolved && d.holding !== "schedule"
      ),
    [discrepancies]
  )
  const accepted = useMemo(
    () =>
      discrepancies.filter(
        (d) => MISMATCH_TYPES.has(d.type) && !d.resolved && d.holding === "schedule"
      ),
    [discrepancies]
  )
  // Notes are the one-off events (duplicates, stale reports, missing sectors),
  // and `resolved` is just their settled state — so they live in ONE tab with
  // the handled ones listed under the open ones, not in a second tab called
  // "Resolved". Two tabs whose names both mean "dealt with" (Accepted /
  // Resolved) read as duplicates of each other; they were actually the settled
  // halves of two different things.
  //
  // Both lists are scoped to non-mismatch types: a resolved comparison would
  // otherwise fall through to here and render as a prose card, which is the
  // presentation the comparison cards exist to replace.
  const notes = useMemo(
    () =>
      discrepancies
        .filter((d) => !MISMATCH_TYPES.has(d.type) && !d.resolved)
        .sort((a, b) => b.createdAt - a.createdAt),
    [discrepancies]
  )
  const handledNotes = useMemo(
    () =>
      discrepancies
        .filter((d) => !MISMATCH_TYPES.has(d.type) && d.resolved)
        .sort((a, b) => (b.resolvedAt ?? b.createdAt) - (a.resolvedAt ?? a.createdAt)),
    [discrepancies]
  )

  const groups = useMemo(
    () => groupMismatches(mismatches, flightsById),
    [mismatches, flightsById]
  )
  const acceptedGroups = useMemo(
    () => groupMismatches(accepted, flightsById),
    [accepted, flightsById]
  )

  /**
   * Sweep out accepted changes whose window has closed. Done here rather than
   * on a timer because this is the only page that can act on them — a row the
   * user can no longer see or revert has nothing left to offer.
   */
  useEffect(() => {
    let cancelled = false
    purgeExpiredAcceptedDiscrepancies()
      .then((purged) => {
        if (purged > 0 && !cancelled) refresh()
      })
      .catch((error) => {
        console.error("[Discrepancies] Retention sweep failed:", error)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  /**
   * Take one side of a comparison: write the value onto the flight and record
   * which side it now holds. Nothing is deleted — the other value stays on the
   * row, so the decision can be flipped back for as long as the row lives.
   * Taking the company's side moves the card to Accepted and starts its clock;
   * taking yours back moves it to Comparisons and stops it.
   */
  const handleHoldingChange = useCallback(
    async (row: Discrepancy, holding: "logbook" | "schedule") => {
      const value =
        holding === "schedule" ? row.scheduleValue : row.logbookValue
      if (!row.flightLogId || !row.field || value === undefined) return

      await updateFlight(row.flightLogId, {
        [row.field]: coerce(row.field, value),
      } as Partial<FlightLog>)
      await setDiscrepancyHolding(row.id, holding)
      await refresh()
    },
    [refresh]
  )

  const handleReopen = useCallback(
    async (d: Discrepancy) => {
      const { unresolveDiscrepancy } = await import("@/lib/db")
      await unresolveDiscrepancy(d.id)
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
      : filterType === "accepted"
        ? acceptedGroups.length
        : notes.length + handledNotes.length

  const cardGroups = filterType === "accepted" ? acceptedGroups : groups

  return (
    <PageContainer>
      <div className="px-4 pt-4 space-y-4">
        <FilterChips<FilterType>
          value={filterType}
          onChange={setFilterType}
          options={[
            {
              value: "comparisons",
              label: "Comparisons",
              count: groups.length,
            },
            {
              value: "accepted",
              label: "Accepted",
              count: acceptedGroups.length,
            },
            { value: "notes", label: "Notes", count: notes.length },
          ]}
        />

        {isLoading && discrepancies.length === 0 && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        )}

        {(filterType === "comparisons" || filterType === "accepted") &&
          cardGroups.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              {filterType === "comparisons"
                ? "Where your entry and the company report differ. Tap a side to put it on record — you can switch back at any time."
                : "Changes where you took the company's figure. Tap your value to put it back — after 90 days these are cleared and it can't be recovered."}
            </p>
            <div className="space-y-3">
              <AnimatePresence initial={false} mode="popLayout">
                {cardGroups.map((group) => (
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

        {filterType === "notes" && (
          <div className="space-y-3">
            <AnimatePresence initial={false} mode="popLayout">
              {notes.map((discrepancy) => (
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
                    onReopen={handleReopen}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Handled notes stay in the same tab, below the open ones — they
                are the same list in its settled state, not a separate concern. */}
            {handledNotes.length > 0 && (
              <>
                <h2 className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Handled
                </h2>
                <AnimatePresence initial={false} mode="popLayout">
                  {handledNotes.map((discrepancy) => (
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
                        onReopen={handleReopen}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </>
            )}
          </div>
        )}

        {showing === 0 && !isLoading && (
          <EmptyState
            icon={filterType === "comparisons" ? CheckCircle2 : AlertCircle}
            iconClassName={
              filterType === "comparisons" ? "text-status-valid/60" : undefined
            }
            title={EMPTY_STATES[filterType].title}
            description={EMPTY_STATES[filterType].description}
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
