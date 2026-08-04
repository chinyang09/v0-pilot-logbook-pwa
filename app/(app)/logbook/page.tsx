"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { FlightList, type FlightListRef } from "@/components/flight-list"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useDebounce } from "@/hooks/use-debounce"
import { LogbookCalendar, type CalendarHandle } from "@/components/logbook-calendar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type FlightLog } from "@/lib/db"
import { syncService } from "@/lib/sync"
import { useCreateFlight } from "@/hooks/use-create-flight"
import {
  useFlights,
  refreshAllData,
  useDBReady,
  useAircraft,
  useAirportDatabase,
  usePersonnel,
  CACHE_KEYS,
} from "@/hooks/data"
import { mutate } from "swr"
import { Calendar, Plus, Search, X, ChevronDown } from "lucide-react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { MORPH_EASE } from "@/lib/motion"
import { parseYMDLocal as parseDateLocal } from "@/lib/utils/date"
import { insertFlightSorted } from "@/lib/utils/flight-sort"
import { UnifiedImportButton } from "@/components/import/unified-import-button"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useSearchParams } from "next/navigation"
import { usePageActive } from "@/hooks/use-page-active"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassButtonGroup, GlassGroupButton, GlassIconButton } from "@/components/ui/glass-icon-button"

/** ONE clock for the floating panels and the list spacer they push. Both use
 *  this exact string, so the calendar's collapse and the list's reserved
 *  space are the same movement instead of two curves running side by side. */
const PANEL_MOTION = `height 300ms ${MORPH_EASE}`

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export default function LogbookPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isReady: dbReady, isLoading: dbLoading } = useDBReady()

  const { flights, isLoading: flightsLoading, refresh: refreshFlights } = useFlights()
  const { aircraft } = useAircraft()
  const { airports } = useAirportDatabase()
  const { personnel } = usePersonnel()
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
  const [activeFilterType, setActiveFilterType] = useState<"none" | "flight" | "aircraft" | "airport" | "crew">("none")
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearchQuery = useDebounce(searchQuery, 150)
  const [searchFocused, setSearchFocused] = useState(false)
  const [selectedFilters, setSelectedFilters] = useState<string[]>([])
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const { handleScroll } = useScrollNavbarContext()

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
  const calendarContentRef = useRef<HTMLDivElement>(null)

  // Measure calendar's natural height + container width for dual-month detection
  const [calendarNaturalHeight, setCalendarNaturalHeight] = useState(0)
  const [searchBlockHeight, setSearchBlockHeight] = useState(0)
  const [mainPanelWidth, setMainPanelWidth] = useState(0)

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

  useEffect(() => {
    const el = calendarContainerRef.current
    if (!el) return
    let rafId = 0
    // The calendar stays MOUNTED and is collapsed to height 0, so its natural
    // height is always readable — measuring the animating wrapper would read
    // whatever the transition is passing through.
    const measure = () => {
      const h = calendarContentRef.current?.offsetHeight ?? 0
      if (h > 0) setCalendarNaturalHeight(h)
      const w = el.offsetWidth
      if (w > 0) setMainPanelWidth(w)
    }
    measure()
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(measure)
    })
    observer.observe(el)
    if (calendarContentRef.current) observer.observe(calendarContentRef.current)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(rafId)
    }
  }, [])

  const dualMonth = mainPanelWidth >= 620

  // Track the topmost visible flight for calendar sync + date highlighting
  const topFlightIdRef = useRef<string | null>(null)
  const [topFlightDate, setTopFlightDate] = useState<string | null>(null)

  const syncSourceRef = useRef<"calendar" | "flights" | null>(null)
  const selectedMonthRef = useRef(selectedMonth)
  const showCalendarRef = useRef(showCalendar)

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    selectedMonthRef.current = selectedMonth
  }, [selectedMonth])

  useEffect(() => {
    showCalendarRef.current = showCalendar
  }, [showCalendar])

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
      setTopFlightDate(topFlight.date)

      if (!showCalendarRef.current) return
      if (syncSourceRef.current !== "flights") return

      const flightDate = parseDateLocal(topFlight.date)
      const newYear = flightDate.getFullYear()
      const newMonth = flightDate.getMonth()

      if (newYear !== selectedMonthRef.current.year || newMonth !== selectedMonthRef.current.month) {
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

  const handleFlightDeleted = async () => {
    // Clear the detail panel — the deleted flight's form must not remain open.
    // This also prevents FlightForm's auto-save from re-creating the deleted record in Dexie.
    setSelectedFlightId(null)
    // Flights already removed optimistically from SWR cache in FlightList.
    // Only revalidate stats so totals reflect the deletion.
    await mutate(CACHE_KEYS.stats, undefined, { revalidate: true })
  }

  const filterOptions = useMemo(() => {
    const options = new Set<string>()
    const query = debouncedSearchQuery.toLowerCase()

    switch (activeFilterType) {
      case "flight":
        flights.forEach((f) => {
          if (f.flightNumber && f.flightNumber.toLowerCase().includes(query)) {
            options.add(f.flightNumber)
          }
        })
        break
      case "aircraft":
        aircraft.forEach((a) => {
          if (
            (a.registration && a.registration.toLowerCase().includes(query)) ||
            (a.type && a.type.toLowerCase().includes(query))
          ) {
            options.add(`${a.registration} (${a.type})`)
          }
        })
        break
      case "airport":
        airports.forEach((a) => {
          if ((a.icao && a.icao.toLowerCase().includes(query)) || (a.name && a.name.toLowerCase().includes(query))) {
            options.add(`${a.icao} - ${a.name}`)
          }
        })
        break
      case "crew":
        personnel.forEach((p) => {
          const name = p.name || ""
          if (name.toLowerCase().includes(query)) {
            options.add(name)
          }
        })
        break
    }

    // The list scrolls (max-h-48), so the cap only exists to keep rendering
    // cheap — 10 was low enough that a common type code hid most matches.
    return Array.from(options).slice(0, 50)
  }, [activeFilterType, debouncedSearchQuery, flights, aircraft, airports, personnel])

  const filteredFlights = useMemo(() => {
    let result = flights

    // FREE TEXT — always applied, whether or not a category is active. The
    // category buttons narrow WHERE it looks; they are not a switch that has
    // to be on for typing to do anything (it previously did nothing at all
    // until you picked one).
    const q = debouncedSearchQuery.trim().toLowerCase()
    if (q) {
      const fieldsFor = (f: FlightLog): string[] => {
        switch (activeFilterType) {
          case "flight":
            return [f.flightNumber ?? ""]
          case "aircraft":
            return [f.aircraftReg ?? "", f.aircraftType ?? ""]
          case "airport":
            return [f.departureIcao ?? "", f.arrivalIcao ?? "", f.departureIata ?? "", f.arrivalIata ?? ""]
          case "crew":
            return [f.picName ?? "", f.sicName ?? "", ...(f.additionalCrew?.map((c) => c.name ?? "") ?? [])]
          default:
            return [
              f.flightNumber ?? "",
              f.aircraftReg ?? "",
              f.aircraftType ?? "",
              f.departureIcao ?? "",
              f.arrivalIcao ?? "",
              f.departureIata ?? "",
              f.arrivalIata ?? "",
              f.picName ?? "",
              f.sicName ?? "",
              ...(f.additionalCrew?.map((c) => c.name ?? "") ?? []),
              f.date ?? "",
            ]
        }
      }
      result = result.filter((f) => fieldsFor(f).some((v) => v.toLowerCase().includes(q)))
    }

    if (selectedFilters.length > 0 && activeFilterType !== "none") {
      result = result.filter((flight) => {
        switch (activeFilterType) {
          case "flight":
            return selectedFilters.some((filter) => flight.flightNumber === filter)
          case "aircraft":
            const acLabel = flight.aircraftReg ? `${flight.aircraftReg} (${flight.aircraftType})` : ""
            return selectedFilters.includes(acLabel)
          case "airport":
            return selectedFilters.some((filter) => {
              const icao = filter.split(" - ")[0]
              return flight.departureIcao === icao || flight.arrivalIcao === icao
            })
          case "crew":
            return selectedFilters.some((filter) => {
              if (flight.picName === filter || flight.sicName === filter) return true
              if (flight.additionalCrew?.some((c) => c.name === filter)) return true
              return false
            })
          default:
            return true
        }
      })
    }

    return result
  }, [flights, selectedFilters, activeFilterType, debouncedSearchQuery])

  const clearAllFilters = () => {
    setSelectedDate(null)
    setActiveFilterType("none")
    setSearchQuery("")
    setSelectedFilters([])
  }

  const toggleFilterOption = (option: string) => {
    setSelectedFilters((prev) => (prev.includes(option) ? prev.filter((f) => f !== option) : [...prev, option]))
  }

  const hasActiveFilters = selectedFilters.length > 0
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
          ariaLabel="Toggle calendar"
          ariaPressed={showCalendar}
          active={showCalendar}
          onClick={() => {
            toggleCalendar(!showCalendar)
            setSelectedDate(null)
            setSearchFocused(false)
            if (showCalendar) setShowMonthPicker(false)
          }}
        >
          <Calendar className="h-5 w-5" />
        </GlassGroupButton>

        {showCalendar && (
          <button
            onClick={() => setShowMonthPicker(prev => !prev)}
            aria-label="Select month"
            className="flex items-center gap-1 px-2 py-1 rounded-full text-sm font-medium text-foreground/80 hover:bg-foreground/5 transition-colors min-w-[5.5rem] justify-center"
          >
            {MONTHS[selectedMonth.month]} {selectedMonth.year}
            <ChevronDown className={cn("h-3 w-3 opacity-50 transition-transform", showMonthPicker && "rotate-180")} />
          </button>
        )}

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
  ), [showCalendar, toggleCalendar, createFlight, setSelectedFlightId, selectedMonth, showMonthPicker])

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
        {/* SEARCH — floats with the chrome instead of scrolling away with the
            list, so it is reachable without scrolling back to the top. */}
        <div ref={searchBlockRef} className="px-2 py-1">
          <div className="relative">
            <Input
              placeholder="Search flights..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              className="pl-10 h-10 bg-background/30 backdrop-blur-xl border-border"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
            {(searchFocused || searchQuery || hasActiveFilters) && (
              <button
                type="button"
                onClick={() => {
                  setSearchFocused(false)
                  setSearchQuery("")
                  setActiveFilterType("none")
                  setSelectedFilters([])
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-sm text-primary font-medium"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Category buttons — narrow the free-text search to one field.
              They are a REFINEMENT, not a switch: with none active the query
              still searches every field. */}
          {searchFocused && (
            <div className="flex items-center gap-1.5 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
              {[
                { id: "flight", label: "Flight" },
                { id: "aircraft", label: "Aircraft" },
                { id: "airport", label: "Airport" },
                { id: "crew", label: "Crew" },
              ].map((filter) => (
                <Button
                  key={filter.id}
                  variant={activeFilterType === filter.id ? "secondary" : "ghost"}
                  size="sm"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    const turningOff = activeFilterType === filter.id
                    setActiveFilterType(turningOff ? "none" : (filter.id as typeof activeFilterType))
                    // Only the chips belong to the category — the typed query
                    // survives, because it still searches everything.
                    if (turningOff) setSelectedFilters([])
                  }}
                  className="flex-1 text-xs h-8 font-medium"
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          )}

          {/* Selected filter chips */}
          {selectedFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 animate-in fade-in duration-200">
              {selectedFilters.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => toggleFilterOption(filter)}
                  className="px-2.5 py-1 bg-primary/20 text-primary text-xs rounded-full flex items-center gap-1 font-medium hover:bg-primary/30 transition-colors"
                >
                  {filter}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          {/* Result count — shown whenever anything is narrowing the list */}
          {(hasActiveFilters || debouncedSearchQuery.trim()) && !searchFocused && (
            <div className="flex items-center justify-between mt-2 animate-in fade-in duration-200">
              <span className="text-xs text-muted-foreground">
                {filteredFlights.length} flight
                {filteredFlights.length !== 1 ? "s" : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="text-xs h-7 hover:bg-destructive/10"
              >
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            </div>
          )}

          {/* Suggestions for the active category */}
          {searchFocused && activeFilterType !== "none" && filterOptions.length > 0 && (
            <div className="mt-2 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto overscroll-contain animate-in fade-in slide-in-from-top-2 duration-200">
              {filterOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    toggleFilterOption(option)
                  }}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                    selectedFilters.includes(option) && "bg-primary/10 text-primary",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* CALENDAR — always mounted, collapsed to 0. Mounted rather than
            conditionally rendered so its natural height is always measurable
            and the collapse is a plain height transition the spacer can
            match exactly. */}
        <div
          className="overflow-hidden"
          style={{
            height: showCalendar ? calendarNaturalHeight : 0,
            transition: PANEL_MOTION,
            willChange: "height",
          }}
          aria-hidden={!showCalendar}
        >
          <div ref={calendarContentRef} className="px-2 pb-2">
            <LogbookCalendar
              ref={calendarRef}
              className="bg-transparent shadow-none border-none"
              flights={flights}
              selectedMonth={selectedMonth}
              onMonthChange={handleCalendarMonthChange}
              onDateSelect={handleDateSelect}
              selectedDate={selectedDate || topFlightDate}
              onScrollStart={handleCalendarScrollStart}
              glass
              cornerRadius={20}
              dualMonth={dualMonth}
              view={showMonthPicker ? "monthYear" : "calendar"}
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
        </div>
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
          onScroll={handleScroll}
          topSpacerHeight={`calc(var(--chrome-top) + ${searchBlockHeight + (showCalendar ? calendarNaturalHeight : 0)}px)`}
          topSpacerTransition={PANEL_MOTION}
          selectedFlightId={selectedFlightId}
        />
      </main>
    </div>
  )
}
