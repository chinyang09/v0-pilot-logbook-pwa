"use client"

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react"
import { FlightList, type FlightListRef } from "@/components/flight-list"
import { useDebounce } from "@/hooks/use-debounce"
import { type CalendarHandle } from "@/components/logbook-calendar"
import { CalendarPanel, PANEL_MS, PANEL_MOTION } from "@/components/calendar-panel"
import { type FlightLog } from "@/lib/db"
import { useCreateFlight } from "@/hooks/use-create-flight"
import {
  useFlights,
  refreshAllData,
  useDBReady,
  CACHE_KEYS,
} from "@/hooks/data"
import { mutate } from "swr"
import { Calendar, Plus, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { GlassContainer } from "@/components/ui/glass-container"
import { usePanelDualMonth } from "@/lib/layout/panel-mode"
import { parseYMDLocal as parseDateLocal } from "@/lib/utils/date"
import { insertFlightSorted } from "@/lib/utils/flight-sort"
import { UnifiedImportButton } from "@/components/import/unified-import-button"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useSearchParams } from "next/navigation"
import { usePageActive } from "@/hooks/use-page-active"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassButtonGroup, GlassGroupButton, GlassIconButton } from "@/components/ui/glass-icon-button"

/** ONE clock for the floating panels and the list spacer they push. Both use
 *  this exact string, so the calendar's collapse and the list's reserved
 *  space are the same movement instead of two curves running side by side. */
/**
 * In dual-month mode the two panes are a FIXED pair — odd month on the left,
 * even month on the right (Jan|Feb, Mar|Apr, …). Anchoring the pair to the
 * calendar rather than to whatever month you happened to scroll past is what
 * stops it shuffling by one month at a time: the pair only changes when the
 * top flight leaves it altogether.
 */
function pairStart(month: number): number {
  return month - (month % 2)
}

/** Is `month` one of the two panes currently shown for `anchor`? */
function inSamePair(anchorMonth: number, anchorYear: number, month: number, year: number): boolean {
  const start = pairStart(anchorMonth)
  return year === anchorYear && (month === start || month === start + 1)
}

/** Gap between the CHROME and the first flight card, matching what crew /
 *  aircraft / airports get from their content wrapper. Not applied under an
 *  open panel — that panel's own edge is the separation there. */
const LIST_TOP_GAP = 20

export default function LogbookPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isReady: dbReady, isLoading: dbLoading } = useDBReady()

  const { flights, isLoading: flightsLoading, refresh: refreshFlights } = useFlights()
  const createFlight = useCreateFlight()

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
  const [showMonthPicker, setShowMonthPicker] = useState(false)

  // Detail panel integration
  // The layout now renders FlightForm directly based on selectedId (Smart Switcher pattern).
  // This page only manages selection state - no more pushing ReactNodes via setDetailContent.
  const {
    selectedId: selectedFlightId,
    setSelectedId: setSelectedFlightId,
  } = useDetailPanel()

  // Refresh flight data when this keep-alive page becomes active again
  const isActive = usePageActive("/logbook", refreshFlights)

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
    measure()
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

      const monthFlights = flights.filter((f) => {
        const date = parseDateLocal(f.date)
        return date.getFullYear() === year && date.getMonth() === month
      })

      if (monthFlights.length > 0) {
        // Sort by date (newest first), then by time within the same date (latest first)
        const sortedFlights = [...monthFlights].sort((a, b) => {
          const dateComparison = parseDateLocal(b.date).getTime() - parseDateLocal(a.date).getTime()
          if (dateComparison !== 0) return dateComparison
          // Within same date, sort by outTime (latest first)
          const timeA = a.outTime || "00:00"
          const timeB = b.outTime || "00:00"
          return timeB.localeCompare(timeA)
        })
        flightListRef.current?.scrollToFlight(sortedFlights[0].id)
      }
    },
    [flights],
  )

  const handleFlightScroll = useCallback(
    (topFlight: FlightLog | null) => {
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

    const targetFlight = topFlightIdRef.current
      ? flights.find(f => f.id === topFlightIdRef.current)
      : flights[0]
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
      const targetFlight = flights.find(f => f.date === date)
        ?? flights.find(f => f.date < date)
      if (targetFlight) {
        flightListRef.current?.scrollToFlight(targetFlight.id)
      }
    })
  }, [flights])

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
   * One lowercased haystack per flight, built once per flights array rather
   * than per keystroke. The previous form allocated an 11-element array and
   * lowercased every field of every flight on every term change — with a few
   * thousand flights that is tens of thousands of string allocations between
   * one character and the next, which is exactly when the main thread is
   * needed for the caret.
   *
   * Kept as a per-field LIST rather than one joined string, so a term still has
   * to sit inside a single field — joining would let "wsss wica" match across
   * the boundary between two fields that are only adjacent by accident.
   */
  const searchIndex = useMemo(
    () =>
      flights.map((f) =>
        [
          f.flightNumber,
          f.aircraftReg,
          f.aircraftType,
          f.departureIcao,
          f.arrivalIcao,
          f.departureIata,
          f.arrivalIata,
          f.picName,
          f.sicName,
          ...(f.additionalCrew?.map((c) => c.name) ?? []),
          f.date,
        ]
          .filter((v): v is string => !!v)
          .map((v) => v.toLowerCase()),
      ),
    [flights],
  )

  const filteredFlights = useMemo(() => {
    // Committed chips AND the text still being typed — so a query narrows the
    // list live, and pressing Enter only pins it so the next one can stack.
    const pending = debouncedSearchQuery.trim().toLowerCase()
    const terms = [...searchTerms.map((t) => t.toLowerCase()), ...(pending ? [pending] : [])]
    if (terms.length === 0) return flights

    return flights.filter((_, i) => {
      const fields = searchIndex[i]
      return terms.every((term) => fields.some((v) => v.includes(term)))
    })
  }, [flights, searchTerms, debouncedSearchQuery, searchIndex])

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

  const hasActiveFilters = searchTerms.length > 0 || searchQuery.trim().length > 0
  const isLoading = dbLoading || !dbReady

  // Action buttons for the desktop floating glass bar — each in its own glass container.
  // Height h-14 matches the nav pill.
  // Month/year text is inside the first glass group (not a separate one) so month
  // changes only re-render the text node — the glass DOM stays untouched.
  const selectedDateRef = useRef(selectedDate)
  selectedDateRef.current = selectedDate
  // Re-entrancy guard: a second tap on [+] before the first create finishes
  // must not create a second blank flight.
  const creatingFlightRef = useRef(false)
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

        {/* No month label here. The calendar's own caption names the month and
            is now what opens the picker, so a second expanding label in the
            action bar was saying the same thing twice — and it was the thing
            that grew this group far enough to reach the centred nav pill. */}

        <UnifiedImportButton
          context="logbook"
          onComplete={() => {
            refreshAllData()
          }}
        />
      </GlassButtonGroup>

      <GlassIconButton
        ariaLabel="Add flight"
        onClick={async () => {
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
        }}
      >
        <Plus className="h-5 w-5" />
      </GlassIconButton>
    </>
  ), [showCalendar, toggleCalendar, createFlight, setSelectedFlightId, showSearch, toggleSearch])

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
          style={{
            height: showSearch ? searchBlockHeight : 0,
            transition: PANEL_MOTION,
            willChange: "height",
          }}
          aria-hidden={!showSearch}
        >
          <div ref={searchBlockRef} className="px-2 pt-1 pb-2">
            <GlassContainer cornerRadius={20} className="w-full">
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />

                {/* Committed terms. Each is one criterion and they AND together. */}
                {searchTerms.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => removeSearchTerm(term)}
                    className="flex items-center gap-1 rounded-full bg-[var(--on-glass-accent)] px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-[var(--on-glass-accent-strong)]"
                  >
                    {term}
                    <X className="h-3 w-3" />
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
                  className="min-w-[6rem] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground"
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
          selectedDate={selectedDate || topFlightDate}
          onScrollStart={handleCalendarScrollStart}
          dualMonth={dualMonth}
          splitLayout={isSplitLayout}
          monthYearView={showMonthPicker}
          onHeaderPress={() => setShowMonthPicker((v) => !v)}
          onMonthSelect={(year, month) => {
            setSelectedMonth({ year, month })
            selectedMonthRef.current = { year, month }
            syncSourceRef.current = "calendar"
            handleCalendarMonthChange(year, month)
            setShowMonthPicker(false)
          }}
          onYearChange={(newYear) => {
            setSelectedMonth({ year: newYear, month: selectedMonth.month })
            selectedMonthRef.current = { year: newYear, month: selectedMonth.month }
            syncSourceRef.current = "calendar"
            handleCalendarMonthChange(newYear, selectedMonth.month)
          }}
        />
      </div>

      {/* FLIGHT LIST */}
      <main className="flex-1 overflow-hidden overscroll-contain relative">
        <FlightList
          ref={flightListRef}
          flights={filteredFlights}
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
          topSpacerHeight={`calc(var(--chrome-top) + ${(showSearch || showCalendar ? 0 : LIST_TOP_GAP) + (showSearch ? searchBlockHeight : 0) + (showCalendar ? calendarNaturalHeight : 0)}px)`}
          topSpacerTransition={spacerAnimated ? PANEL_MOTION : "none"}
          selectedFlightId={selectedFlightId}
        />
      </main>
    </div>
  )
}
