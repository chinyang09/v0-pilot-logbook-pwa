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

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useSessionState } from "@/hooks/use-session-state"
import { GlassButtonGroup, GlassIconButton } from "@/components/ui/glass-icon-button"
import { Plus, Shield, AlertCircle, TrendingUp } from "lucide-react"
import { useScheduleEntries, useDiscrepancyCounts, useFlights, refreshAllData } from "@/hooks/data"
import { usePageActive } from "@/hooks/use-page-active"
import { usePreferences } from "@/components/providers/preferences-provider"
import { parseYMDLocal, formatLocalYMD } from "@/lib/utils/date"
import { UnifiedImportButton } from "@/components/import/unified-import-button"
import { DutyDetailPanel } from "@/components/roster/duty-detail-panel"
import { PanelLoading } from "@/components/ui/page-loading"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { RosterMonth } from "@/components/roster/roster-month"
import { RosterAgenda } from "@/components/roster/roster-agenda"
import { deleteScheduleEntry, restoreScheduleEntry } from "@/lib/db"
import { showUndoToast } from "@/lib/utils/undo-toast"
import { standbyActivation } from "@/lib/utils/roster/standby-activation"
import { agendaFrom, buildRosterDays, dayKeyAt } from "@/lib/utils/roster/roster-days"
import type { ScheduleEntry } from "@/types/entities/roster.types"

/** The phone's "a new one is open" selection — never stored (see use-detail-panel). */
const NEW_SENTINEL = "__new__"

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

  // A duty opens in the DETAIL panel — beside the month on a tablet, the
  // full-screen overlay on a phone — the way a flight opens in the logbook.
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const selectedEntry = useMemo(
    () => scheduleEntries.find((e) => e.id === selectedId) ?? null,
    [scheduleEntries, selectedId]
  )

  const openEditDuty = useCallback((entry: ScheduleEntry) => setSelectedId(entry.id), [setSelectedId])

  const handleDeleteDuty = useCallback(
    async (entry: ScheduleEntry) => {
      await deleteScheduleEntry(entry.id)
      if (entry.id === selectedId) setSelectedId(null)
      await refreshEntries()
      refreshAllData()
      showUndoToast(`${entry.dutyCode || "Duty"} deleted`, async () => {
        await restoreScheduleEntry(entry.id)
        await refreshEntries()
        refreshAllData()
      })
    },
    [refreshEntries, selectedId, setSelectedId]
  )

  const handleDutySaved = useCallback(
    async (saved: ScheduleEntry) => {
      await refreshEntries()
      // The FDP pipeline reads schedule entries, so a duty added or edited here
      // has to reach the dashboard's caches too.
      refreshAllData()
      setSelectedId(saved.id)
    },
    [refreshEntries, setSelectedId]
  )

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

  // Keep-alive: only the active tab owns the header actions; re-activation
  // refreshes the schedule and moves "today" on.
  const onActivated = useCallback(() => {
    setNow(Date.now())
    refreshEntries()
  }, [refreshEntries])
  const isActive = usePageActive("/roster", onActivated)

  // While a NEW duty's form is open, data-driven re-syncs must not replace it
  // — but the user choosing another duty ends it (the crew page's rule).
  const creatingRef = useRef<false | { sel: string | null }>(false)

  // Keep-alive: only the ACTIVE roster may write the shared detail panel, or a
  // hidden roster would overwrite the page in front of it.
  const syncDetailPanel = useCallback(() => {
    if (!isActive) return
    if (creatingRef.current) {
      if (selectedId === NEW_SENTINEL || selectedId === creatingRef.current.sel) return
      creatingRef.current = false
    }
    if (entriesLoading && scheduleEntries.length === 0) {
      setDetailContent(<PanelLoading />)
      return
    }
    setDetailContent(
      selectedEntry ? (
        <DutyDetailPanel key={selectedEntry.id} entry={selectedEntry} onSaved={handleDutySaved} />
      ) : null
    )
  }, [isActive, selectedId, selectedEntry, entriesLoading, scheduleEntries.length, handleDutySaved, setDetailContent])

  useEffect(() => {
    syncDetailPanel()
  }, [syncDetailPanel])

  const addDutyOn = useCallback(
    (dayKey: string) => {
      creatingRef.current = { sel: selectedId }
      setDetailContent(
        <DutyDetailPanel
          key={`new-${dayKey}`}
          entry={null}
          defaultDate={dayKey}
          onSaved={async (saved) => {
            creatingRef.current = false
            await handleDutySaved(saved)
          }}
          onCancelNew={() => {
            creatingRef.current = false
            if (isDesktop) syncDetailPanel()
            else setSelectedId(null)
          }}
        />
      )
      // A phone has no panel beside the roster: the sentinel opens the overlay.
      if (!isDesktop) setSelectedId(NEW_SENTINEL)
    },
    [selectedId, isDesktop, handleDutySaved, setDetailContent, setSelectedId, syncDetailPanel]
  )

  // The header's [+] adds on the selected day.
  const openAddDuty = useCallback(() => addDutyOn(selectedKey), [addDutyOn, selectedKey])

  const rosterActions = useMemo(
    () => (
      <>
        {/* TOOLS, then CREATE (see the header rule in glass-icon-button.tsx).
            There is no Refresh: it re-read the local table, which every write
            and every sync already does, so it was a button with nothing to
            show for itself — and easily mistaken for "sync". */}
        <GlassButtonGroup>
          <UnifiedImportButton
            context="roster"
            onComplete={() => {
              refreshEntries()
              refreshAllData()
            }}
          />
        </GlassButtonGroup>
        <GlassIconButton ariaLabel="Add duty" onClick={openAddDuty}>
          <Plus className="h-5 w-5" />
        </GlassIconButton>
      </>
    ),
    [refreshEntries, openAddDuty]
  )

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
            // Lit only where the panel beside the roster shows it.
            selectedId={isDesktop ? selectedId : null}
            onEditDuty={openEditDuty}
            onDeleteDuty={handleDeleteDuty}
            onAddDuty={addDutyOn}
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

    </>
  )
}
