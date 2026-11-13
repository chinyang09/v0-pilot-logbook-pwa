"use client"

import { flightSearchFields, matchesTerms, prepareTerm, squashFields } from "@/lib/utils/logbook-search"
import { SEARCH_INPUT_PROPS } from "@/lib/utils/input-props"
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react"
import { FlightList, type FlightListRef, type TopRow } from "@/components/flight-list"
import { useDebounce } from "@/hooks/use-debounce"
import { type CalendarHandle } from "@/components/logbook-calendar"
import { CalendarPanel, PANEL_MS, PANEL_MOTION, useStowedWhenClosed } from "@/components/calendar-panel"
import { type FlightLog } from "@/lib/db"
import { useCreateFlight } from "@/hooks/use-create-flight"
import {
  useFlights,
  useScheduleEntries,
  refreshAllData,
  useDBReady,
  CACHE_KEYS,
} from "@/hooks/data"
import { mutate } from "swr"
import { Calendar, Plane, Plus, Search, SearchX, X } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { GlassContainer } from "@/components/ui/glass-container"
import { pairStart, usePanelDualMonth } from "@/lib/layout/panel-mode"
import { parseYMDLocal as parseDateLocal, formatLocalYMD } from "@/lib/utils/date"
import { ChoicePicker } from "@/components/ui/option-menu"
import { setDutiesView, useCalendarDuties, useListDuties } from "@/hooks/use-calendar-spans"
import { deleteScheduleEntry, restoreScheduleEntry } from "@/lib/db"
import { showUndoToast } from "@/lib/utils/undo-toast"
import { standbyActivation } from "@/lib/utils/roster/standby-activation"
import { buildLogbookRows, dutyDayKey, dutyRowKey, dutySearchFields, isRosterDuty, newDutyKey, rowCoversDate } from "@/lib/utils/logbook-rows"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { insertFlightSorted } from "@/lib/utils/flight-sort"
import { UnifiedImportButton } from "@/components/import/unified-import-button"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useSearchParams } from "next/navigation"
import { usePageActive } from "@/hooks/use-page-active"
import { isShortcut } from "@/lib/utils/shortcuts"
import { whenIdle } from "@/lib/utils/idle"
import { prewarmAirportClocks } from "@/lib/db/stores/reference/airports.store"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassButtonGroup, GlassGroupButton, GlassIconButton } from "@/components/ui/glass-icon-button"

/** What the header's + offers once the roster's duties are in the list. */
type AddKind = "" | "flight" | "duty"
const ADD_OPTIONS: { value: AddKind; label: string }[] = [
  { value: "flight", label: "Flight" },
  { value: "duty", label: "Duty" },
]

/** ONE clock for the floating panels and the list spacer they push. Both use
 *  this exact string, so the calendar's collapse and the list's reserved
 *  space are the same movement instead of two curves running side by side. */
/** Is `month` one of the two panes currently shown for `anchor`? */
function inSamePair(anchorMonth: number, anchorYear: number, month: number, year: number): boolean {
  const start = pairStart(anchorMonth)
  return year === anchorYear && (month === start || month === start + 1)
}

/** Gap between the CHROME and the first flight card, matching what crew /
 *  aircraft / airports get from their content wrapper. Not applied under an
 *  open panel — that panel's own edge is the separation there. */
const LIST_TOP_GAP = 16

export default function LogbookPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isReady: dbReady, isLoading: dbLoading } = useDBReady()

  const { flights, isLoading: flightsLoading, refresh: refreshFlights } = useFlights()
  const createFlight = useCreateFlight()

  // THE ROSTER IS THIS LIST WITH ITS DUTIES ON. One control, in the
  // calendar's header (`useDutiesView`): duties hidden, on the calendar, or on
  // the calendar AND as cards among the flights. The list's own share is the
  // last: the month with its roster while the list shows flights alone is the
  // common case, so it is the default.
  const showDuties = useListDuties()
  const calendarDuties = useCalendarDuties()
  /** Duties are being looked at somewhere — so + offers to add one. */
  const dutiesInView = showDuties || calendarDuties
  const { scheduleEntries, refresh: refreshEntries } = useScheduleEntries()
  const rosterDuties = useMemo(
    () => (showDuties ? scheduleEntries.filter(isRosterDuty) : []),
    [showDuties, scheduleEntries]
  )
  // `?duties=1` — a link that means the roster (the dashboard's duty line, an
  // old /roster bookmark) turns the duties on as it arrives, then drops the
  // parameter so a later reload keeps whatever the pilot chooses.
  const wantsDuties = searchParams.get("duties") === "1"
  useEffect(() => {
    if (!wantsDuties) return
    setDutiesView("all")
    const url = new URL(window.location.href)
    url.searchParams.delete("duties")
    window.history.replaceState(window.history.state, "", url.toString())
  }, [wantsDuties])

  /** When each called-out standby was called (para 6(6)) — one walk, not one per card. */
  const calledOut = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of rosterDuties) {
      if (entry.dutyType !== "standby") continue
      const activation = standbyActivation(entry, flights)
      if (activation) map.set(entry.id, activation.at)
    }
    return map
  }, [rosterDuties, flights])

  // Initialize calendar state from URL (preserves state when switching layouts)
  const [showCalendar, setShowCalendar] = useState(() => {
    if (typeof window !== "undefined") {
      return searchParams.get("calendar") === "true"
    }
    return false
  })

  // Sync calendar state to URL
  const toggleCalendar = useCallback((show: boolean) => {
    setShowCalendar(show)
    const url = new URL(window.location.href)
    if (show) {
      url.searchParams.set("calendar", "true")
    } else {
      url.searchParams.delete("calendar")
    }
    window.history.replaceState({}, "", url.toString())
  }, [])
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearchQuery = useDebounce(searchQuery, 150)
  /** Committed search terms. Every one must match (AND), so terms stack:
   *  "TR647" + "WSSS" is that flight number AND that airport. */
  const [searchTerms, setSearchTerms] = useState<string[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const searchStow = useStowedWhenClosed(showSearch)
  const [showMonthPicker, setShowMonthPicker] = useState(false)

  // Detail panel integration
  // The layout now renders FlightForm directly based on selectedId (Smart Switcher pattern).
  // This page only manages selection state - no more pushing ReactNodes via setDetailContent.
  const {
    selectedId: selectedFlightId,
    setSelectedId: setSelectedFlightId,
  } = useDetailPanel()

  // Refresh flight data when this keep-alive page becomes active again — at
  // idle, not in the tab switch (see whenIdle).
  const refreshFlightsWhenIdle = useCallback(() => whenIdle(refreshFlights), [refreshFlights])

  // The first flight opened would otherwise build its airports' offset
  // formatters inside the tap. Once per session, at idle, for the airports of
  // the most recent flights (the list is newest first).
  useEffect(() => {
    if (flights.length === 0) return
    whenIdle(() => {
      const recent = flights.slice(0, 20)
      void prewarmAirportClocks(recent.flatMap((f) => [f.departureIcao, f.arrivalIcao]))
    }, 4000)
  }, [flights])
  const isActive = usePageActive("/logbook", refreshFlightsWhenIdle)
  const calendarRef = useRef<CalendarHandle>(null)
  const flightListRef = useRef<FlightListRef>(null)
  const calendarContainerRef = useRef<HTMLDivElement>(null)

  const searchBlockRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Declared (and kept in step) ahead of the measuring effects below, which
  // read it from their ResizeObserver callback.
  const showCalendarRef = useRef(showCalendar)
  useEffect(() => {
    showCalendarRef.current = showCalendar
  }, [showCalendar])

  // Measure calendar's natural height + container width for dual-month detection
  const [calendarNaturalHeight, setCalendarNaturalHeight] = useState(0)
  /** Last measured calendar height, to spot a resize-while-open (see below). */
  const calendarHeightRef = useRef(0)
  const pendingAbsorbRef = useRef(0)
  /** False for the one commit that applies a resize-driven spacer change. */
  const [spacerAnimated, setSpacerAnimated] = useState(true)
  const [searchBlockHeight, setSearchBlockHeight] = useState(0)

  // The search block floats above the list, so the list has to reserve its
  // height. It only changes on focus/blur (the filter row and suggestions
  // appear), so this is a handful of measurements, not a per-frame cost.
  useEffect(() => {
    const el = searchBlockRef.current
    if (!el) return
    let rafId = 0
    const measure = () => setSearchBlockHeight(el.offsetHeight)
    // No synchronous first measure: the observer reports the first size after
    // the browser's own layout, where reading it here forced a layout of the
    // whole app at mount (~60ms at a 4× throttle). The height is only read
    // while search is OPEN, and the search starts stowed.
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(measure)
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [])

  /**
   * The calendar's natural height, reported by `CalendarPanel` (which measures
   * its own content — the calendar stays MOUNTED and collapsed to 0, so what it
   * reads is never a frame of the transition).
   *
   * The absorb logic below is the load-bearing part and is unchanged: a
   * calendar that is already OPEN and merely changes SHAPE (one month → two,
   * when the panel widens) moves the spacer under a list that is not being
   * pushed. Anchoring is off on that scroller by design, so the delta is
   * absorbed here — otherwise switching the panel width slid the whole logbook
   * a couple of rows.
   *
   * The spacer also has to make that change INSTANTLY rather than over
   * PANEL_MOTION: the compensation is a single `scrollTop` write, so an eased
   * spacer would drift against it for 300ms.
   */
  const handleCalendarHeight = useCallback((h: number) => {
    if (h <= 0) return
    const prev = calendarHeightRef.current
    calendarHeightRef.current = h
    if (prev > 0 && prev !== h && showCalendarRef.current) {
      pendingAbsorbRef.current += h - prev
      setSpacerAnimated(false)
    }
    setCalendarNaturalHeight(h)
  }, [])

  // Apply a queued resize compensation in the same paint as the spacer's new
  // height — a layout effect, so the reader never sees the intermediate frame.
  useLayoutEffect(() => {
    const delta = pendingAbsorbRef.current
    if (!delta) return
    pendingAbsorbRef.current = 0
    flightListRef.current?.absorbSpacerDelta(delta)
    const t = setTimeout(() => setSpacerAnimated(true), 0)
    return () => clearTimeout(t)
  }, [calendarNaturalHeight])

  // Read from the LAYOUT, which knows the moment it resizes the panel. Deriving
  // it from this page's own ResizeObserver put the switch a frame or two behind
  // the resize, and in those frames the calendar rendered the outgoing mode at
  // the incoming width — the flash on the collapse.
  const dualMonth = usePanelDualMonth()
  const isSplitLayout = useIsDesktop()

  // Track the topmost visible flight for calendar sync + date highlighting
  const topFlightIdRef = useRef<string | null>(null)
  const [topFlightDate, setTopFlightDate] = useState<string | null>(null)
  const topFlightDateRef = useRef<string | null>(null)

  const syncSourceRef = useRef<"calendar" | "flights" | null>(null)
  const selectedMonthRef = useRef(selectedMonth)
  const dualMonthRef = useRef(false)

  // No `onDataChanged` subscription here: `SyncProvider` owns the one global
  // one, and this page is keep-alive — a second permanent subscriber just ran
  // the whole refresh twice per sync cycle.

  useEffect(() => {
    selectedMonthRef.current = selectedMonth
  }, [selectedMonth])

  // Entering dual mode snaps the anchor to its pair boundary. LEAVING it keeps
  // whichever pane the top flight is actually in — if that is the right-hand
  // month, the left one stows rather than the right.
  useEffect(() => {
    const wasDual = dualMonthRef.current
    dualMonthRef.current = dualMonth
    if (wasDual === dualMonth) return

    const current = selectedMonthRef.current
    const top = topFlightDateRef.current ? parseDateLocal(topFlightDateRef.current) : null

    if (dualMonth) {
      const next = { year: current.year, month: pairStart(current.month) }
      selectedMonthRef.current = next
      setSelectedMonth(next)
      return
    }

    // dual → single
    const keep =
      top && inSamePair(current.month, current.year, top.getMonth(), top.getFullYear())
        ? { year: top.getFullYear(), month: top.getMonth() }
        : current
    selectedMonthRef.current = keep
    setSelectedMonth(keep)
  }, [dualMonth])

  const handleCalendarMonthChange = useCallback(
    (year: number, month: number) => {
      setSelectedMonth({ year, month })
      selectedMonthRef.current = { year, month }

      if (syncSourceRef.current !== "calendar") {
        return
      }

      // The list is already in its order, newest first (`getAllFlights`), so
      // the month's newest flight is the first whose date carries the month.
      // It used to filter every flight through a Date and re-sort them on each
      // step of a swipe or a wheel spin — and by OUT alone, so it could pick a
      // different leg from the one the list shows first.
      const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`
      flightListRef.current?.scrollToFirst((row) => row.date.startsWith(prefix))
    },
    [],
  )

  const handleFlightScroll = useCallback(
    (topFlight: TopRow | null) => {
      if (!topFlight) return
      topFlightIdRef.current = topFlight.id
      topFlightDateRef.current = topFlight.date

      // The calendar is the ONLY consumer of `topFlightDate`, and it is
      // collapsed to height 0 rather than unmounted when stowed — so while it
      // is closed this setState re-rendered the page and a whole month grid
      // once per card scrolled past, for something nobody can see. The ref
      // above is kept current either way, and opening the calendar seeds the
      // state from it (see toggleCalendar).
      if (!showCalendarRef.current) return
      setTopFlightDate(topFlight.date)

      if (syncSourceRef.current !== "flights") return

      const flightDate = parseDateLocal(topFlight.date)
      const newYear = flightDate.getFullYear()
      const newMonth = flightDate.getMonth()

      const current = selectedMonthRef.current
      if (dualMonthRef.current) {
        // The pair holds while the top flight is in either pane, and jumps a
        // whole pair when it isn't — never one month at a time.
        if (inSamePair(current.month, current.year, newMonth, newYear)) return
        const target = { year: newYear, month: pairStart(newMonth) }
        selectedMonthRef.current = target
        setSelectedMonth(target)
        calendarRef.current?.scrollToMonth(target.year, target.month)
        return
      }

      if (newYear !== current.year || newMonth !== current.month) {
        selectedMonthRef.current = { year: newYear, month: newMonth }
        setSelectedMonth({ year: newYear, month: newMonth })
        calendarRef.current?.scrollToMonth(newYear, newMonth)
      }
    },
    [],
  )

  // Sync calendar to current top flight whenever calendar becomes visible
  const calendarSyncedRef = useRef(false)
  useEffect(() => {
    if (!showCalendar) {
      calendarSyncedRef.current = false
      return
    }
    if (calendarSyncedRef.current || flights.length === 0 || flightsLoading) return
    calendarSyncedRef.current = true

    // The row at the top may be a duty: its DATE is what the calendar needs.
    const topDate = topFlightDateRef.current ?? flights[0]?.date
    const targetFlight = topDate ? { date: topDate } : null
    if (targetFlight) {
      const date = parseDateLocal(targetFlight.date)
      const year = date.getFullYear()
      const month = date.getMonth()
      setSelectedMonth({ year, month })
      selectedMonthRef.current = { year, month }
      // Catch the highlight up to wherever the list was scrolled to while the
      // calendar was stowed — `handleFlightScroll` only keeps the ref current
      // in that state, so this is where the state re-joins it.
      setTopFlightDate(targetFlight.date)
      calendarRef.current?.scrollToMonth(year, month)
      syncSourceRef.current = "flights"
    }
  }, [showCalendar, flights, flightsLoading])

  const handleCalendarScrollStart = useCallback(() => {
    syncSourceRef.current = "calendar"
  }, [])

  const handleFlightScrollStart = useCallback(() => {
    syncSourceRef.current = "flights"
    setSelectedDate(null) // Clear calendar selection so highlight follows top flight
  }, [])

  const handleDateSelect = useCallback((date: string) => {
    setSelectedDate(date)
    syncSourceRef.current = "calendar"

    // Defer scroll to next frame so state updates settle first
    requestAnimationFrame(() => {
      const list = flightListRef.current
      if (!list) return
      // That day's first row — a flight or a duty — else the next day before it.
      if (!list.scrollToFirst((row) => rowCoversDate(row, date))) list.scrollToFirst((row) => row.date < date)
    })
  }, [])

  // The calendar's Today: the month that holds it, and the list at it.
  const handleToday = useCallback(() => {
    const now = new Date()
    // In dual mode the panes are a fixed odd|even pair: anchor on its start.
    const month = dualMonthRef.current ? pairStart(now.getMonth()) : now.getMonth()
    const next = { year: now.getFullYear(), month }
    setSelectedMonth(next)
    selectedMonthRef.current = next
    handleDateSelect(formatLocalYMD(now))
  }, [handleDateSelect])

  // A flight opened from ELSEWHERE — a note's "Open flight", Next Leg, a link
  // with ?selected= — was lit in the list but left wherever the list was, so
  // on a tablet the panel showed one flight and the list another month. Bring
  // the row into view once, when the selection changes; a row the pilot just
  // tapped is already on screen, so that is a no-op. In a timeout, after the
  // commit has painted, so the visibility check reads a clean layout.
  const revealedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isActive || !selectedFlightId || revealedRef.current === selectedFlightId) return
    const id = selectedFlightId
    const t = window.setTimeout(() => {
      if (flightListRef.current?.revealFlight(id)) revealedRef.current = id
    }, 0)
    return () => window.clearTimeout(t)
  }, [isActive, selectedFlightId, flights])

  // Handle flight selection from list
  // Sets selectedId which the AppShell renders as:
  // - Desktop: FlightForm in right detail panel
  // - Mobile: FlightForm in full-screen overlay
  const handleEditFlight = useCallback((flight: FlightLog) => {
    setSelectedFlightId(flight.id)
  }, [setSelectedFlightId])

  // MUST stay stable. It is `FlightList`'s `onDeleted`, which its `performDelete`
  // and `handleToggleLock` close over — so a fresh identity here changed the
  // `onDelete` prop of every `SwipeableFlightCard` on every render of this page,
  // and this page re-renders on scroll (the top-flight date) and on every
  // keystroke in search. The cards are `memo`'d; unstable callbacks were the
  // one thing defeating it.
  const handleFlightDeleted = useCallback(async () => {
    // Clear the detail panel — the deleted flight's form must not remain open.
    // This also prevents FlightForm's auto-save from re-creating the deleted record in Dexie.
    setSelectedFlightId(null)
    // Flights already removed optimistically from SWR cache in FlightList.
    // Only revalidate stats so totals reflect the deletion.
    await mutate(CACHE_KEYS.stats, undefined, { revalidate: true })
  }, [setSelectedFlightId])

  /**
   * One SQUASHED haystack per flight (`flightSearchFields`), built once per
   * flights array rather than per keystroke — with a few thousand flights,
   * rebuilding it between one character and the next is exactly when the
   * main thread is needed for the caret. What a term matches is
   * `lib/utils/logbook-search.ts`: case, spacing and dashes do not matter,
   * a flight number's leading zeros do not, a route is one term, a date is
   * found in the forms a pilot writes one.
   */
  const searchIndex = useMemo(() => flights.map(flightSearchFields), [flights])

  // Committed chips AND the text still being typed — so a query narrows the
  // list live, and pressing Enter only pins it so the next one can stack.
  const preparedTerms = useMemo(() => {
    const pending = debouncedSearchQuery.trim()
    return [...searchTerms, ...(pending ? [pending] : [])].map(prepareTerm)
  }, [searchTerms, debouncedSearchQuery])

  const filteredFlights = useMemo(() => {
    if (preparedTerms.length === 0) return flights
    return flights.filter((_, i) => matchesTerms(searchIndex[i], preparedTerms))
  }, [flights, preparedTerms, searchIndex])

  /** Stow/open the search row. Opening focuses the field; stowing clears the
   *  filters, because a hidden filter silently narrowing the logbook is the
   *  kind of thing you spend ten minutes not noticing. */
  const toggleSearch = useCallback(() => {
    setShowSearch((open) => {
      if (open) {
        setSearchQuery("")
        setSearchTerms([])
      } else {
        // Focus only once the row has finished opening, and never let the
        // focus scroll anything into view: focusing mid-transition made the
        // browser try to reveal a box that was still growing, which is what
        // the open read as jank.
        setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), PANEL_MS + 20)
      }
      return !open
    })
  }, [])

  const clearAllFilters = useCallback(() => {
    setSelectedDate(null)
    setSearchQuery("")
    setSearchTerms([])
  }, [])

  /** Pin the typed text as a chip so the next term stacks on top of it. */
  const commitSearchTerm = useCallback(() => {
    const term = searchQuery.trim()
    if (!term) return
    setSearchTerms((prev) => (prev.some((t) => t.toLowerCase() === term.toLowerCase()) ? prev : [...prev, term]))
    setSearchQuery("")
  }, [searchQuery])

  const removeSearchTerm = useCallback((term: string) => {
    setSearchTerms((prev) => prev.filter((t) => t !== term))
  }, [])

  // The same terms narrow the duties: a code, a description, the kind ("standby").
  const filteredDuties = useMemo(() => {
    if (preparedTerms.length === 0) return rosterDuties
    return rosterDuties.filter((entry) => matchesTerms(squashFields(dutySearchFields(entry)), preparedTerms))
  }, [rosterDuties, preparedTerms])

  const hasActiveFilters = searchTerms.length > 0 || searchQuery.trim().length > 0
  const isLoading = dbLoading || !dbReady

  // Action buttons for the desktop floating glass bar — each in its own glass container.
  // Height h-14 matches the nav pill.
  // Month/year text is inside the first glass group (not a separate one) so month
  // changes only re-render the text node — the glass DOM stays untouched.
  const selectedDateRef = useRef(selectedDate)
  selectedDateRef.current = selectedDate
  const selectedFlightIdRef = useRef(selectedFlightId)
  useEffect(() => {
    selectedFlightIdRef.current = selectedFlightId
  }, [selectedFlightId])
  // Re-entrancy guard: a second tap on [+] before the first create finishes
  // must not create a second blank flight.
  const creatingFlightRef = useRef(false)
  const handleAddFlight = useCallback(async () => {
    if (creatingFlightRef.current) return
    creatingFlightRef.current = true
    try {
      const newFlight = await createFlight(selectedDateRef.current || undefined)
      // Placed by the shared comparator, not prepended: a new flight
      // belongs at its date and time straight away, or it sits at the
      // top of the logbook until the next refetch and then jumps.
      mutate(
        CACHE_KEYS.flights,
        (prev: FlightLog[] | undefined) =>
          insertFlightSorted(prev ?? [], newFlight),
        { revalidate: false }
      )
      setSelectedFlightId(newFlight.id)
    } finally {
      creatingFlightRef.current = false
    }
  }, [createFlight, setSelectedFlightId])

  // A new duty opens in the detail panel on the day in view (the calendar's
  // tapped day), else today; nothing is written until it is saved.
  const handleAddDuty = useCallback(() => {
    setSelectedFlightId(newDutyKey(selectedDateRef.current || new Date().toISOString().slice(0, 10)))
  }, [setSelectedFlightId])

  const handleEditDuty = useCallback(
    (entry: ScheduleEntry) => setSelectedFlightId(dutyRowKey(entry.id)),
    [setSelectedFlightId]
  )

  // A card may be a run of whole days (a week of leave): it is binned whole,
  // and Undo brings the whole run back.
  const handleDeleteDuty = useCallback(
    async (entries: ScheduleEntry[]) => {
      if (entries.length === 0) return
      for (const entry of entries) await deleteScheduleEntry(entry.id)
      if (entries.some((e) => selectedFlightIdRef.current === dutyRowKey(e.id) || selectedFlightIdRef.current === dutyDayKey(e.id)))
        setSelectedFlightId(null)
      await refreshEntries()
      refreshAllData()
      const name = entries[0].dutyCode || "Duty"
      showUndoToast(entries.length > 1 ? `${name} × ${entries.length} deleted` : `${name} deleted`, async () => {
        for (const entry of entries) await restoreScheduleEntry(entry.id)
        await refreshEntries()
        refreshAllData()
      })
    },
    [refreshEntries, setSelectedFlightId]
  )

  const handleAdd = useCallback(
    (kind: AddKind) => {
      if (kind === "duty") handleAddDuty()
      else if (kind === "flight") void handleAddFlight()
    },
    [handleAddDuty, handleAddFlight]
  )

  // Why the list is empty decides what it should offer. A search that matched
  // nothing used to read "No flights logged — add your first flight" to a
  // pilot with a thousand of them.
  const emptyState = useMemo(
    () =>
      hasActiveFilters && flights.length > 0 ? (
        <EmptyState
          icon={SearchX}
          title="No Matching Flights"
          description="Every term must match."
          action={
            <Button variant="outline" size="sm" onClick={clearAllFilters}>
              Clear Search
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={Plane}
          title="No Flights Logged"
          description="Add one, or import a report or LogTen export."
          action={
            <Button variant="outline" size="sm" onClick={handleAddFlight}>
              <Plus className="mr-1 h-4 w-4" /> Add Flight
            </Button>
          }
        />
      ),
    [hasActiveFilters, flights.length, clearAllFilters, handleAddFlight]
  )

  // The logbook from a keyboard (`isShortcut` says when a key is one): `/`
  // opens search, `N` starts a flight, and with a flight open the arrows move
  // to the one above or below — reading down a month without going back to
  // the list for each. Only while this page is the one on screen: it is
  // keep-alive, and a hidden logbook must not answer another page's keys.
  useEffect(() => {
    if (!isActive) return
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return
      if (e.key === "/") {
        if (showSearch) searchInputRef.current?.focus({ preventScroll: true })
        else toggleSearch()
      } else if (e.key === "n" || e.key === "N") {
        handleAddFlight()
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && selectedFlightId && isSplitLayout) {
        // Only from the LIST's side. With focus in the open flight, the
        // arrows are that panel's own (they scroll it, they turn a wheel).
        const el = e.target as Element | null
        if (el !== document.body && !el?.closest?.('[data-slot="card"]')) return
        // Through the list as it stands — flights and duties alike.
        const rows = buildLogbookRows(filteredFlights, filteredDuties)
        const at = rows.findIndex((r) => r.key === selectedFlightId)
        const next = rows[at + (e.key === "ArrowDown" ? 1 : -1)]
        if (at === -1 || !next) return
        setSelectedFlightId(next.key)
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isActive, showSearch, toggleSearch, handleAddFlight, selectedFlightId, filteredFlights, filteredDuties, setSelectedFlightId, isSplitLayout])

  const logbookActions = useMemo(() => (
    <>
      <GlassButtonGroup>
        <GlassGroupButton
          ariaLabel="Toggle search"
          ariaPressed={showSearch}
          active={showSearch}
          onClick={toggleSearch}
        >
          <Search className="h-5 w-5" />
        </GlassGroupButton>

        <GlassGroupButton
          ariaLabel="Toggle calendar"
          ariaPressed={showCalendar}
          active={showCalendar}
          onClick={() => {
            toggleCalendar(!showCalendar)
            setSelectedDate(null)
            if (showCalendar) setShowMonthPicker(false)
          }}
        >
          <Calendar className="h-5 w-5" />
        </GlassGroupButton>

        {/* Where duties show is the CALENDAR's control (its header's
            Duties menu) — the list's duty cards are its third choice. */}

        {/* No month label here. The calendar's own caption names the month and
            is now what opens the picker, so a second expanding label in the
            action bar was saying the same thing twice — and it was the thing
            that grew this group far enough to reach the centred nav pill. */}
      </GlassButtonGroup>

      {/* VIEW, then TOOLS, then CREATE — one capsule per role (see the header
          rule in glass-icon-button.tsx). Import brings data in; it is not a
          way of looking at the logbook, so it is not in the view group. */}
      <GlassButtonGroup>
        <UnifiedImportButton
          context="logbook"
          onComplete={() => {
            refreshAllData()
          }}
        />
      </GlassButtonGroup>

      {/* CREATE. The logbook alone adds a flight in one tap; with the roster's
          duties shown (in the list or on the calendar) it asks which — a
          flight or a duty, from one place. */}
      {dutiesInView ? (
        <GlassContainer cornerRadius={22} overBlur>
          <ChoicePicker<AddKind>
            label="Add"
            value=""
            options={ADD_OPTIONS}
            onValueChange={handleAdd}
            morph
            className="flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-[var(--on-glass-fill-soft)]"
          >
            <Plus className="h-5 w-5" />
          </ChoicePicker>
        </GlassContainer>
      ) : (
        <GlassIconButton
          ariaLabel="Add flight"
          onClick={handleAddFlight}
        >
          <Plus className="h-5 w-5" />
        </GlassIconButton>
      )}
    </>
  ), [showCalendar, toggleCalendar, handleAddFlight, showSearch, toggleSearch, dutiesInView, handleAdd])

  // Register actions for the desktop floating bar
  useRegisterMainActions(logbookActions, isActive)

  return (
    <div className="h-full relative flex flex-col">
      {/* FLOATING PANEL STACK — search, then the calendar. Absolute so the
          flight list scrolls behind it (needed for the glass see-through),
          with the list reserving the stack's height in its top spacer. Both
          the calendar's collapse and the list's spacer run on PANEL_MOTION,
          the same duration and curve, so they are one movement rather than a
          panel opening and a list catching up after it. */}
      <div
        ref={calendarContainerRef}
        className="z-40 absolute left-0 right-0"
        style={{ top: "var(--chrome-top)", contain: "layout style paint" }}
      >
        {/* SEARCH — stowed by default, opened from the header button. It sits
            between the action buttons and the calendar, and collapses the same
            way the calendar does so the list is pushed by one movement
            whichever of the two is opening. */}
        <div
          className="overflow-hidden"
          onTransitionEnd={searchStow.onTransitionEnd}
          style={{
            height: showSearch ? searchBlockHeight : 0,
            transition: PANEL_MOTION,
          }}
          aria-hidden={!showSearch}
          // Stowed at 0px but mounted — inert keeps the hidden field out of
          // the tab order (see CalendarPanel).
          inert={!showSearch}
        >
          <div ref={searchBlockRef} className="px-2 pb-2" style={searchStow.contentStyle}>
            <GlassContainer cornerRadius={20} className="w-full">
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />

                {/* Committed terms. Each is one criterion and they AND together. */}
                {searchTerms.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => removeSearchTerm(term)}
                    aria-label={`Remove search term ${term}`}
                    className="relative flex items-center gap-1 rounded-full after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] bg-[var(--on-glass-accent)] px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-[var(--on-glass-accent-strong)]"
                  >
                    {term}
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                ))}

                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      commitSearchTerm()
                    } else if (e.key === "Backspace" && !searchQuery && searchTerms.length) {
                      // Standard token-field behaviour: backspace on an empty
                      // field takes the last chip back.
                      e.preventDefault()
                      setSearchTerms((prev) => prev.slice(0, -1))
                    }
                  }}
                  enterKeyHint="done"
                  placeholder={searchTerms.length ? "Add filter…" : "Search flights…"}
                  aria-label="Search flights"
                  {...SEARCH_INPUT_PROPS}
                  className="min-w-[6rem] flex-1 border-0 bg-transparent p-0 text-base outline-none placeholder:text-muted-foreground"
                />

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    aria-label="Clear all filters"
                    className="flex-shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </GlassContainer>
          </div>
        </div>

        {/* CALENDAR — the shared panel, so this and the dashboard cannot drift
            into looking like two different calendars again. */}
        <CalendarPanel
          ref={calendarRef}
          open={showCalendar}
          onNaturalHeight={handleCalendarHeight}
          flights={flights}
          selectedMonth={selectedMonth}
          onMonthChange={handleCalendarMonthChange}
          onDateSelect={handleDateSelect}
          onToday={handleToday}
          dutiesInList
          selectedDate={selectedDate || topFlightDate}
          onScrollStart={handleCalendarScrollStart}
          dualMonth={dualMonth}
          splitLayout={isSplitLayout}
          monthYearView={showMonthPicker}
          onHeaderPress={() => {
            // While the wheels are up the month being chosen is the LEFT pane,
            // whatever its parity; closing them snaps a pair back to its
            // odd|even phase (as the dashboard does), or the next step moves
            // Feb–Mar to Apr–May and every pair after it is out of phase.
            if (showMonthPicker && dualMonth) {
              const current = selectedMonthRef.current
              const next = { year: current.year, month: pairStart(current.month) }
              if (next.month !== current.month) {
                selectedMonthRef.current = next
                setSelectedMonth(next)
              }
            }
            setShowMonthPicker((v) => !v)
          }}
          onMonthSelect={(year, month) => {
            // Live: the wheels move the calendar and the list as they settle,
            // and the date selector closes the picker.
            setSelectedMonth({ year, month })
            selectedMonthRef.current = { year, month }
            syncSourceRef.current = "calendar"
            handleCalendarMonthChange(year, month)
          }}
        />
      </div>

      {/* FLIGHT LIST */}
      <main className="flex-1 overflow-hidden overscroll-contain relative">
        <FlightList
          ref={flightListRef}
          flights={filteredFlights}
          duties={filteredDuties}
          calledOut={calledOut}
          onEditDuty={handleEditDuty}
          onDeleteDuty={handleDeleteDuty}
          isLoading={flightsLoading || isLoading}
          onEdit={handleEditFlight}
          onDeleted={handleFlightDeleted}
          onTopFlightChange={handleFlightScroll}
          onScrollStart={handleFlightScrollStart}
          // `LIST_TOP_GAP` separates the first card from the CHROME, which is
          // where crew / aircraft / airports get theirs — the logbook was alone
          // in butting its first card straight against the header.
          //
          // It is dropped while a panel is open: the calendar and the search
          // block carry their own bottom edge, so the gap would read as slack
          // hanging off the panel rather than as breathing room under the
          // chrome. Only one of the two is ever the thing above the list.
          topGapPx={showSearch || showCalendar ? 0 : LIST_TOP_GAP}
          topSpacerHeight={`calc(var(--chrome-top) + ${(showSearch || showCalendar ? 0 : LIST_TOP_GAP) + (showSearch ? searchBlockHeight : 0) + (showCalendar ? calendarNaturalHeight : 0)}px)`}
          topSpacerTransition={spacerAnimated ? PANEL_MOTION : "none"}
          selectedFlightId={selectedFlightId}
          emptyState={emptyState}
        />
      </main>
    </div>
  )
}
