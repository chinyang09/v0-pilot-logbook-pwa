"use client"

/**
 * The roster, CALENDAR FIRST.
 *
 * A month on top — each day says what it is (SBY, OFF, TR602) — and under it
 * the agenda, day by day and SOONEST FIRST from the day selected (today unless
 * you pick another). The old page was a newest-first list of every date ever
 * imported with the calendar behind a toggle, so the next duty — the one thing
 * a roster is opened for — sat at the far end of the history.
 *
 * The roster shows the logbook's flights alongside its own duties: a roster
 * without its flights is half a roster. They stay the logbook's (read-only
 * here; tapping one opens it there) — `scheduleEntries` still holds non-flight
 * duties only.
 */

import { useState, useMemo, useCallback } from "react"
import Link from "next/link"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useSessionState } from "@/hooks/use-session-state"
import { GlassButtonGroup, GlassGroupButton } from "@/components/ui/glass-icon-button"
import { RefreshCw, Plus, Shield, AlertCircle, TrendingUp } from "lucide-react"
import { useScheduleEntries, useDiscrepancyCounts, useFlights, refreshAllData } from "@/hooks/data"
import { usePageActive } from "@/hooks/use-page-active"
import { usePreferences } from "@/components/providers/preferences-provider"
import { cn } from "@/lib/utils"
import { parseYMDLocal, formatLocalYMD } from "@/lib/utils/date"
import { UnifiedImportButton } from "@/components/import/unified-import-button"
import { DutyEntryDialog } from "@/components/roster/duty-entry-dialog"
import { RosterMonth } from "@/components/roster/roster-month"
import { RosterAgenda } from "@/components/roster/roster-agenda"
import { deleteScheduleEntry, restoreScheduleEntry } from "@/lib/db"
import { showUndoToast } from "@/lib/utils/undo-toast"
import { standbyActivation } from "@/lib/utils/roster/standby-activation"
import { agendaFrom, buildRosterDays, dayKeyAt } from "@/lib/utils/roster/roster-days"
import type { ScheduleEntry } from "@/types/entities/roster.types"

const QUICK_LINK =
  "flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-secondary active:bg-secondary"

export default function RosterPage() {
  const { preferences } = usePreferences()
  const display = preferences.display
  const zulu = display.useZuluTime ?? true

  const { scheduleEntries, isLoading: entriesLoading, refresh: refreshEntries } = useScheduleEntries()
  const { counts: discrepancyCounts } = useDiscrepancyCounts()
  const { flights } = useFlights()

  // "Today" moves on when the page comes back into view — it is keep-alive,
  // so a value taken once at mount would still say yesterday tomorrow.
  const [now, setNow] = useState(() => Date.now())
  const todayKey = useMemo(() => dayKeyAt(now, { zulu }), [now, zulu])

  const [storedSelection, setSelectedKey] = useSessionState<string | null>("roster:selectedDate", null)
  const selectedKey = storedSelection ?? todayKey

  const days = useMemo(() => buildRosterDays(scheduleEntries, flights, { zulu }), [scheduleEntries, flights, zulu])
  const agenda = useMemo(() => agendaFrom(days, selectedKey), [days, selectedKey])

  // Add / edit. `editing` null with the dialog open means "add".
  const [dutyDialogOpen, setDutyDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null)

  const openAddDuty = useCallback(() => {
    setEditingEntry(null)
    setDutyDialogOpen(true)
  }, [])

  const openEditDuty = useCallback((entry: ScheduleEntry) => {
    setEditingEntry(entry)
    setDutyDialogOpen(true)
  }, [])

  const handleDeleteDuty = useCallback(
    async (entry: ScheduleEntry) => {
      await deleteScheduleEntry(entry.id)
      await refreshEntries()
      refreshAllData()
      showUndoToast(`${entry.dutyCode || "Duty"} deleted`, async () => {
        await restoreScheduleEntry(entry.id)
        await refreshEntries()
        refreshAllData()
      })
    },
    [refreshEntries]
  )

  const handleDutySaved = useCallback(async () => {
    await refreshEntries()
    // The FDP pipeline reads schedule entries, so a duty added or edited here
    // has to reach the dashboard's caches too.
    refreshAllData()
  }, [refreshEntries])

  /**
   * Which standby duties were called out, and when (para 6(6)). Built once
   * rather than per row: `standbyActivation` walks the flights.
   */
  const activations = useMemo(() => {
    const map = new Map<string, ReturnType<typeof standbyActivation>>()
    for (const entry of scheduleEntries) {
      if (entry.dutyType !== "standby") continue
      const activation = standbyActivation(entry, flights)
      if (activation) map.set(entry.id, activation)
    }
    return map
  }, [scheduleEntries, flights])

  const selectDay = useCallback((key: string) => setSelectedKey(key), [setSelectedKey])
  const selectToday = useCallback(() => setSelectedKey(null), [setSelectedKey])

  // A month step lands on today when that month holds it, else on the 1st —
  // so the agenda under the new month starts where the month does.
  const stepMonth = useCallback(
    (delta: number) => {
      const anchor = parseYMDLocal(selectedKey)
      const first = formatLocalYMD(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1))
      setSelectedKey(first.slice(0, 7) === todayKey.slice(0, 7) ? null : first)
    },
    [selectedKey, todayKey, setSelectedKey]
  )

  const rosterActions = useMemo(
    () => (
      <>
        <GlassButtonGroup>
          <GlassGroupButton ariaLabel="Refresh roster" onClick={() => refreshEntries()} disabled={entriesLoading}>
            <RefreshCw className={cn("h-5 w-5", entriesLoading && "animate-spin")} />
          </GlassGroupButton>
        </GlassButtonGroup>
        <GlassButtonGroup>
          <UnifiedImportButton
            context="roster"
            onComplete={() => {
              refreshEntries()
              refreshAllData()
            }}
          />
          <GlassGroupButton ariaLabel="Add duty" onClick={openAddDuty}>
            <Plus className="h-5 w-5" />
          </GlassGroupButton>
        </GlassButtonGroup>
      </>
    ),
    [refreshEntries, entriesLoading, openAddDuty]
  )

  // Keep-alive: only the active tab owns the header actions; re-activation
  // refreshes the schedule and moves "today" on.
  const onActivated = useCallback(() => {
    setNow(Date.now())
    refreshEntries()
  }, [refreshEntries])
  const isActive = usePageActive("/roster", onActivated)

  useRegisterMainActions(rosterActions, isActive)

  const nothingYet = !entriesLoading && scheduleEntries.length === 0 && flights.length === 0

  return (
    <>
      <PageContainer>
        <div className="mx-auto max-w-2xl space-y-4 px-panel pt-4">
          <RosterMonth
            selectedKey={selectedKey}
            todayKey={todayKey}
            days={days}
            onSelect={selectDay}
            onStep={stepMonth}
            onToday={selectToday}
          />

          {nothingYet && (
            <p className="px-1 text-sm text-muted-foreground">
              Import a schedule report with the upload button above, or add a duty by hand.
            </p>
          )}

          <RosterAgenda
            agenda={agenda}
            todayKey={todayKey}
            display={display}
            activations={activations}
            onEditDuty={openEditDuty}
            onDeleteDuty={handleDeleteDuty}
            onAddDuty={openAddDuty}
          />

          <nav aria-label="Related" className="flex flex-wrap gap-2 pt-2">
            <Link href="/currencies" className={QUICK_LINK}>
              <Shield className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>Currencies</span>
            </Link>
            <Link href="/discrepancies" className={QUICK_LINK}>
              <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>Discrepancies</span>
              {discrepancyCounts.unresolved > 0 && (
                <span className="shrink-0 rounded-full bg-secondary px-1.5 text-[10px] font-semibold tabular-nums">
                  {discrepancyCounts.unresolved}
                </span>
              )}
            </Link>
            <Link href="/fdp" className={QUICK_LINK}>
              <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>FDP</span>
            </Link>
          </nav>
        </div>
      </PageContainer>

      <DutyEntryDialog
        // Remount on the entry (or, for a new duty, the selected day) so the
        // form re-seeds from its `useState` initialisers — no seeding effect.
        key={editingEntry?.id ?? `new-${selectedKey}`}
        open={dutyDialogOpen}
        entry={editingEntry}
        defaultDate={selectedKey}
        onClose={() => setDutyDialogOpen(false)}
        onSaved={handleDutySaved}
      />
    </>
  )
}
