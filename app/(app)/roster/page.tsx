"use client"

/**
 * The roster, CALENDAR FIRST.
 *
 * A month on top — each day says what it is (SBY, OFF, TR602) — STUCK under
 * the header, and under it the agenda, every rostered day in date order. A
 * tapped day scrolls to just under the month and scrolling moves the month's
 * selection to the day at the top — the logbook's calendar and list. It used
 * to rebuild the agenda from the tapped day, so the days before it were gone.
 *
 * The roster shows the logbook's flights alongside its own duties: a roster
 * without its flights is half a roster. They stay the logbook's —
 * `scheduleEntries` still holds non-flight duties only — but a tapped flight
 * opens in THIS page's detail panel (`flight:<id>`), so Back returns to the
 * roster. It used to be a link into the logbook, and Back went there instead.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { mutate } from "swr"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useSessionState } from "@/hooks/use-session-state"
import { GlassButtonGroup, GlassIconButton } from "@/components/ui/glass-icon-button"
import { Plus } from "lucide-react"
import { useScheduleEntries, useFlights, refreshAllData, CACHE_KEYS } from "@/hooks/data"
import { FlightForm } from "@/components/flight-form"
import { syncService } from "@/lib/sync"
import { usePageActive } from "@/hooks/use-page-active"
import { whenIdle } from "@/lib/utils/idle"
import { usePreferences } from "@/components/providers/preferences-provider"
import { parseYMDLocal, formatLocalYMD } from "@/lib/utils/date"
import { UnifiedImportButton } from "@/components/import/unified-import-button"
import { DutyDetailPanel } from "@/components/roster/duty-detail-panel"
import { PanelLoading } from "@/components/ui/page-loading"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { RosterMonth } from "@/components/roster/roster-month"
import { RosterAgenda, type RosterAgendaHandle } from "@/components/roster/roster-agenda"
import { useFloatingPanelUnderHeader } from "@/lib/layout/panel-mode"
import { deleteScheduleEntry, restoreScheduleEntry } from "@/lib/db"
import { showUndoToast } from "@/lib/utils/undo-toast"
import { standbyActivation } from "@/lib/utils/roster/standby-activation"
import { rosterAgenda, buildRosterDays, dayKeyAt } from "@/lib/utils/roster/roster-days"
import type { ScheduleEntry } from "@/types/entities/roster.types"

/** The phone's "a new one is open" selection — never stored (see use-detail-panel). */
const NEW_SENTINEL = "__new__"
/** A logbook flight opened from the agenda — namespaced, as a duty id could collide. */
const FLIGHT_PREFIX = "flight:"

export default function RosterPage() {
  const { preferences } = usePreferences()
  const display = preferences.display
  const zulu = display.useZuluTime ?? true

  const { scheduleEntries, isLoading: entriesLoading, refresh: refreshEntries } = useScheduleEntries()
  const { flights, isLoading: flightsLoading } = useFlights()

  // "Today" moves on when the page comes back into view — it is keep-alive,
  // so a value taken once at mount would still say yesterday tomorrow.
  const [now, setNow] = useState(() => Date.now())
  const todayKey = useMemo(() => dayKeyAt(now, { zulu }), [now, zulu])

  const [storedSelection, setSelectedKey] = useSessionState<string | null>("roster:selectedDate", null)
  const selectedKey = storedSelection ?? todayKey

  // A day the pilot TAPPED stays in the list even when empty (it says
  // "Nothing rostered" and offers Add Duty). It is not the selection, which
  // also follows the scroll: a quiet day leaving the list as it scrolled past
  // would move every row under the reader.
  const [pinnedKey, setPinnedKey] = useState<string | null>(storedSelection)

  const days = useMemo(() => buildRosterDays(scheduleEntries, flights, { zulu }), [scheduleEntries, flights, zulu])
  const agenda = useMemo(
    () => rosterAgenda(days, pinnedKey ? [todayKey, pinnedKey] : [todayKey]),
    [days, todayKey, pinnedKey]
  )
  // The page's scroller, which the virtualised agenda shares with the month,
  // and the month itself, stuck under the header.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [stickyEl, setStickyEl] = useState<HTMLElement | null>(null)
  const agendaRef = useRef<RosterAgendaHandle>(null)
  // Where to scroll once the list has the day in it (a tap may add the row).
  const [scrollTarget, setScrollTarget] = useState<{ key: string; behavior: ScrollBehavior } | null>(null)

  // A duty opens in the DETAIL panel — beside the month on a tablet, the
  // full-screen overlay on a phone — the way a flight opens in the logbook.
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const selectedEntry = useMemo(
    () => scheduleEntries.find((e) => e.id === selectedId) ?? null,
    [scheduleEntries, selectedId]
  )

  const openEditDuty = useCallback((entry: ScheduleEntry) => setSelectedId(entry.id), [setSelectedId])
  const openFlight = useCallback((flightId: string) => setSelectedId(`${FLIGHT_PREFIX}${flightId}`), [setSelectedId])

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

  const goTo = useCallback(
    (key: string, opts: { pin?: boolean } = {}) => {
      setSelectedKey(key === todayKey ? null : key)
      if (opts.pin) setPinnedKey(key)
      setScrollTarget({ key, behavior: "smooth" })
    },
    [todayKey, setSelectedKey]
  )
  const selectDay = useCallback((key: string) => goTo(key, { pin: true }), [goTo])
  const selectToday = useCallback(() => goTo(todayKey), [goTo, todayKey])
  // The list scrolled a different day to the top: the month follows it.
  const followTopDay = useCallback(
    (key: string) => setSelectedKey(key === todayKey ? null : key),
    [todayKey, setSelectedKey]
  )

  // A month step lands on today when that month holds it, else on its first
  // rostered day, else on the 1st (shown empty, with Add Duty).
  const stepMonth = useCallback(
    (delta: number) => {
      const anchor = parseYMDLocal(selectedKey)
      const first = formatLocalYMD(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1))
      const month = first.slice(0, 7)
      if (month === todayKey.slice(0, 7)) return goTo(todayKey)
      const busy = [...days.keys()].filter((k) => k.startsWith(month)).sort()[0]
      if (busy) goTo(busy)
      else goTo(first, { pin: true })
    },
    [selectedKey, todayKey, days, goTo]
  )

  // Scroll once the list holds the day: after the commit that may have added
  // its row. The first time, once the data has landed, to the day the page
  // opens on — instantly, as a list opens where it is.
  // NOT keyed on the selection: it follows the scroll, and re-running on it
  // scrolled the list straight back to the last tapped day.
  const openedRef = useRef(false)
  const openKeyRef = useRef(selectedKey)
  useEffect(() => {
    openKeyRef.current = selectedKey
  }, [selectedKey])
  const dataReady = !entriesLoading && !flightsLoading
  useEffect(() => {
    if (!scrollEl || !stickyEl || !dataReady) return
    if (!openedRef.current) {
      openedRef.current = true
      agendaRef.current?.scrollToDay(openKeyRef.current, "instant")
      return
    }
    if (!scrollTarget) return
    agendaRef.current?.scrollToDay(scrollTarget.key, scrollTarget.behavior)
  }, [scrollTarget, scrollEl, stickyEl, dataReady])

  // Keep-alive: only the active tab owns the header actions; re-activation
  // refreshes the schedule and moves "today" on.
  const onActivated = useCallback(() => {
    setNow(Date.now())
    whenIdle(refreshEntries)
  }, [refreshEntries])
  const isActive = usePageActive("/roster", onActivated)
  // The month sits under the action buttons: the header's tap-to-top band and
  // the fade's tail would otherwise take its controls' taps and dim its top.
  useFloatingPanelUnderHeader(isActive)
  // The pathname moves in the same render as a selection, the active-route
  // store a commit later — gate the panel on both (the dashboard's rule).
  const onRoster = usePathname() === "/roster"

  // While a NEW duty's form is open, data-driven re-syncs must not replace it
  // — but the user choosing another duty ends it (the crew page's rule).
  const creatingRef = useRef<false | { sel: string | null }>(false)

  // Keep-alive: only the ACTIVE roster may write the shared detail panel, or a
  // hidden roster would overwrite the page in front of it.
  const syncDetailPanel = useCallback(() => {
    if (!isActive || !onRoster) return
    if (creatingRef.current) {
      if (selectedId === NEW_SENTINEL || selectedId === creatingRef.current.sel) return
      creatingRef.current = false
    }
    if (selectedId?.startsWith(FLIGHT_PREFIX)) {
      const flightId = selectedId.slice(FLIGHT_PREFIX.length)
      setDetailContent(
        <div className="h-full overflow-hidden bg-background">
          <FlightForm
            key={flightId}
            flightId={flightId}
            isDesktop={isDesktop}
            onFlightAdded={() => {
              mutate(CACHE_KEYS.flights)
              if (navigator.onLine) syncService.fullSync()
            }}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )
      return
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
  }, [isActive, onRoster, selectedId, selectedEntry, entriesLoading, scheduleEntries.length, handleDutySaved, isDesktop, setDetailContent, setSelectedId])

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
      <PageContainer title="Roster" mainRef={setScrollEl} scrollRestoreKey={null}>
        <div className="mx-auto max-w-2xl px-panel">
          {/* Stuck under the header; the list scrolls beneath it. Once stuck,
              its ::before covers the header band above it, or rows passing
              under the month would show again above it. */}
          <div
            ref={setStickyEl}
            className="roster-month-sticky sticky z-10 bg-background pb-1 pt-4"
            style={{ top: "var(--chrome-top)" }}
          >
            <RosterMonth
              selectedKey={selectedKey}
              todayKey={todayKey}
              days={days}
              onSelect={selectDay}
              onStep={stepMonth}
              onToday={selectToday}
            />
            {nothingYet && (
              <p className="px-1 pt-3 text-sm text-muted-foreground">Import a schedule or add a duty.</p>
            )}
          </div>

          <RosterAgenda
            controlRef={agendaRef}
            agenda={agenda}
            todayKey={todayKey}
            display={display}
            activations={activations}
            scrollElement={scrollEl}
            stickyElement={stickyEl}
            onTopDayChange={followTopDay}
            onOpenFlight={openFlight}
            // Lit only where the panel beside the roster shows it.
            selectedId={isDesktop ? selectedId : null}
            onEditDuty={openEditDuty}
            onDeleteDuty={handleDeleteDuty}
            onAddDuty={addDutyOn}
          />
        </div>
      </PageContainer>

    </>
  )
}
