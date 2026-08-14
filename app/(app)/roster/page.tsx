"use client"

import { useState, useMemo, useCallback, useLayoutEffect, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useSessionState } from "@/hooks/use-session-state"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassButtonGroup, GlassGroupButton } from "@/components/ui/glass-icon-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { FormSection } from "@/components/ui/form-section"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Calendar as CalendarIcon,
  AlertCircle,
  RefreshCw,
  List,
  CalendarDays,
  ChevronLeft,
  Shield,
  TrendingUp,
  ArrowRight,
  Plus,
  Trash2,
} from "lucide-react"
import {
  useScheduleEntries,
  useCurrencies,
  useDiscrepancyCounts,
  useFlights,
  refreshAllData,
} from "@/hooks/data"
import { usePageActive } from "@/hooks/use-page-active"
import { cn } from "@/lib/utils"
import { formatYMD } from "@/lib/utils/date"
import Link from "next/link"
import { DutyEntryCard, RosterCalendar } from "@/components/roster"
import { FastScroll, generateYearItems } from "@/components/ui/fast-scroll"
import { UnifiedImportButton } from "@/components/import/unified-import-button"
import { DutyEntryDialog } from "@/components/roster/duty-entry-dialog"
import { SwipeableCard } from "@/components/swipeable-card"
import { deleteScheduleEntry } from "@/lib/db"
import { standbyActivation } from "@/lib/utils/roster/standby-activation"
import type { ScheduleEntry } from "@/types/entities/roster.types"

type ViewMode = "list" | "calendar"

export default function RosterPage() {
  const [viewMode, setViewMode] = useSessionState<ViewMode>("roster:viewMode", "list")
  const [selectedDate, setSelectedDate] = useSessionState<string | null>("roster:selectedDate", null)

  const { scheduleEntries, isLoading: entriesLoading, refresh: refreshEntries } = useScheduleEntries()
  const { currencies } = useCurrencies()
  const { counts: discrepancyCounts } = useDiscrepancyCounts()
  const { flights } = useFlights()

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
   * Which standby duties were called out, and when (para 6(6)).
   *
   * Built once for the whole list rather than per card: `standbyActivation`
   * walks the flights, and the roster renders one card per duty for the entire
   * imported history.
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

  // Group schedule entries by date. Memoized on the data itself — without this,
  // sortedDates gets a new identity every render and every downstream
  // useMemo/useCallback keyed on it recomputes for nothing.
  const { entriesByDate, sortedDates } = useMemo(() => {
    const byDate = scheduleEntries.reduce(
      (acc, entry) => {
        if (!acc[entry.date]) {
          acc[entry.date] = []
        }
        acc[entry.date].push(entry)
        return acc
      },
      {} as Record<string, typeof scheduleEntries>
    )
    return {
      entriesByDate: byDate,
      sortedDates: Object.keys(byDate).sort((a, b) => b.localeCompare(a)),
    }
  }, [scheduleEntries])

  // Derived, never stored: entries for the selected day always reflect the
  // latest data (a stored copy went stale after sync and rendered an empty
  // day view when selectedDate was restored from sessionStorage).
  const selectedEntries = selectedDate ? (entriesByDate[selectedDate] ?? []) : []

  // Generate FastScroll items from dates — year buckets with 2-digit labels
  // (like the logbook rail) so they fit the narrow rail and never overflow.
  const fastScrollItems = useMemo(() => {
    return generateYearItems(sortedDates);
  }, [sortedDates]);

  const [activeYearKey, setActiveYearKey] = useState<string | undefined>(undefined);

  // ─── Virtualized date list ───────────────────────────────────
  // One virtual row per date group, scrolling inside PageContainer's <main>.
  // A year of airline roster is 300+ date cards / 600+ duty entries — rendering
  // them all made Roster the only unvirtualized long list in the app.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const mainRef = useCallback((node: HTMLElement | null) => setScrollEl(node), [])

  const listRef = useRef<HTMLDivElement>(null)
  const listOffsetRef = useRef(0)
  // Measured every render (KPI cards above the list change height as data
  // loads); ref write only, no render loop.
  useLayoutEffect(() => {
    listOffsetRef.current = listRef.current?.offsetTop ?? 0
  })

  const dateVirtualizer = useVirtualizer({
    count: sortedDates.length,
    getScrollElement: () => scrollEl,
    // Rough guess: section header + ~64px per compact entry; measureElement corrects.
    estimateSize: (i) => 48 + (entriesByDate[sortedDates[i]]?.length ?? 1) * 64,
    overscan: 4,
    scrollMargin: listOffsetRef.current,
    getItemKey: (i) => sortedDates[i],
  })

  const handleFastScrollSelect = useCallback((year: string) => {
    setActiveYearKey(year);

    // sortedDates is newest-first, so the first match is that year's latest date.
    const index = sortedDates.findIndex((date) => date.split("-")[0] === year);

    if (index !== -1) {
      dateVirtualizer.scrollToIndex(index, { align: "start", behavior: "auto" });
    }
  }, [sortedDates, dateVirtualizer]);

  const handleDateClick = (date: string) => {
    setSelectedDate(date)
    setViewMode("list")
  }

  const handleBackToCalendar = () => {
    setSelectedDate(null)
  }

  // Glass action buttons for the floating header bar
  const rosterActions = useMemo(() => (
    <>
      <GlassButtonGroup>
        <GlassGroupButton
          ariaLabel="Refresh roster"
          onClick={() => refreshEntries()}
          disabled={entriesLoading}
        >
          <RefreshCw className={cn("h-5 w-5", entriesLoading && "animate-spin")} />
        </GlassGroupButton>
        <GlassGroupButton
          ariaLabel="List view"
          ariaPressed={viewMode === "list"}
          active={viewMode === "list"}
          onClick={() => setViewMode("list")}
        >
          <List className="h-5 w-5" />
        </GlassGroupButton>
        <GlassGroupButton
          ariaLabel="Calendar view"
          ariaPressed={viewMode === "calendar"}
          active={viewMode === "calendar"}
          onClick={() => setViewMode("calendar")}
        >
          <CalendarDays className="h-5 w-5" />
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
  ), [refreshEntries, entriesLoading, viewMode, setViewMode, openAddDuty])

  // Keep-alive: only the active tab owns the header actions; re-activation
  // refreshes the schedule so the retained page stays accurate.
  const isActive = usePageActive("/roster", refreshEntries)

  useRegisterMainActions(rosterActions, isActive)

  return (
    <>
      <PageContainer
        mainRef={mainRef}
        rightContent={
          viewMode === "list" && !selectedDate && fastScrollItems.length > 1 ? (
            <FastScroll
              items={fastScrollItems}
              activeKey={activeYearKey}
              onSelect={handleFastScrollSelect}
              indicatorPosition="left"
            />
          ) : null
        }
      >
        <div className="px-panel pt-4 space-y-4">

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-2">
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold">{scheduleEntries.length}</div>
              <div className="text-xs text-muted-foreground">Schedule Entries</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold">{currencies.length}</div>
              <div className="text-xs text-muted-foreground">Currencies</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="text-2xl font-bold text-status-warning">{discrepancyCounts.unresolved}</div>
              <div className="text-xs text-muted-foreground">Discrepancies</div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Access Navigation — active: press feedback so the cards feel
            tappable on touch, matching the sidebar items / glass buttons. */}
        {scheduleEntries.length > 0 && (
          // block h-full on the Link + h-full on the Card: the grid stretches
          // the Links to one row height, but without h-full the Cards stayed
          // content-sized — when "FDP Dashboard" wrapped at narrow widths its
          // card was visibly taller than its siblings.
          <div className="grid grid-cols-3 gap-2">
            <Link href="/currencies" className="block h-full">
              <Card className="h-full hover:bg-secondary/50 active:bg-secondary/50 active:scale-[0.98] transition-[background-color,transform] cursor-pointer">
                <CardContent className="pt-4 pb-3 px-3">
                  <div className="flex items-center justify-between mb-1">
                    <Shield className="h-5 w-5 text-status-valid" />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="text-xs font-medium">Currencies</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/discrepancies" className="block h-full">
              <Card className="h-full hover:bg-secondary/50 active:bg-secondary/50 active:scale-[0.98] transition-[background-color,transform] cursor-pointer">
                <CardContent className="pt-4 pb-3 px-3">
                  <div className="flex items-center justify-between mb-1">
                    <AlertCircle className="h-5 w-5 text-status-warning" />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="text-xs font-medium">Discrepancies</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/fdp" className="block h-full">
              <Card className="h-full hover:bg-secondary/50 active:bg-secondary/50 active:scale-[0.98] transition-[background-color,transform] cursor-pointer">
                <CardContent className="pt-4 pb-3 px-3">
                  <div className="flex items-center justify-between mb-1">
                    <TrendingUp className="h-5 w-5 text-status-info" />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="text-xs font-medium">FDP Dashboard</div>
                </CardContent>
              </Card>
            </Link>
          </div>
        )}

        {/* First-load skeleton */}
        {entriesLoading && scheduleEntries.length === 0 && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2 pt-3 px-3">
                  <Skeleton className="h-4 w-32" />
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty State */}
        {scheduleEntries.length === 0 && !entriesLoading && (
          <EmptyState
            icon={CalendarIcon}
            title="No Schedule Data"
            description="Use the upload button above to import your Crew Logbook or Schedule report (CSV/PDF)."
          />
        )}

        {/* Calendar View */}
        {viewMode === "calendar" && sortedDates.length > 0 && (
          <RosterCalendar entries={scheduleEntries} onDateClick={handleDateClick} />
        )}

        {/* List View */}
        {viewMode === "list" && sortedDates.length > 0 && (
          <div className={`space-y-3 ${!selectedDate && fastScrollItems.length > 1 ? "pr-8" : ""}`}>
            {selectedDate ? (
              <>
                {/* Selected Date Details */}
                <div className="flex items-center gap-2 mb-4">
                  <Button variant="ghost" size="sm" onClick={handleBackToCalendar}>
                    <ChevronLeft className="h-4 w-4" />
                    Back to Calendar
                  </Button>
                  <h2 className="text-lg font-semibold">
                    {formatYMD(selectedDate, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }, "en-US")}
                  </h2>
                </div>
                {selectedEntries.map((entry) => (
                  <SwipeableCard
                    key={entry.id}
                    id={entry.id}
                    actions={[
                      {
                        icon: <Trash2 className="h-5 w-5" />,
                        ariaLabel: "Delete duty",
                        variant: "destructive",
                        onClick: () => handleDeleteDuty(entry),
                      },
                    ]}
                  >
                    <DutyEntryCard
                      entry={entry}
                      activation={activations.get(entry.id) ?? null}
                      onClick={() => openEditDuty(entry)}
                    />
                  </SwipeableCard>
                ))}
              </>
            ) : (
              /* All Dates List — virtualized (one row per date group) so the
                 whole history stays scrollable without rendering hundreds of
                 cards. Grouped-section style matches the rest of the app. */
              <div
                ref={listRef}
                className="relative"
                style={{ height: `${dateVirtualizer.getTotalSize()}px` }}
              >
                {dateVirtualizer.getVirtualItems().map((vRow) => {
                  const date = sortedDates[vRow.index]
                  return (
                    <div
                      key={vRow.key}
                      data-index={vRow.index}
                      ref={dateVirtualizer.measureElement}
                      className="absolute top-0 left-0 w-full pb-3"
                      style={{
                        transform: `translateY(${vRow.start - dateVirtualizer.options.scrollMargin}px)`,
                      }}
                    >
                      <FormSection
                        title={formatYMD(date, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        }, "en-US")}
                      >
                        <div className="p-3 space-y-2">
                          {entriesByDate[date].map((entry) => (
                            <SwipeableCard
                              key={entry.id}
                              id={entry.id}
                              variant="row"
                              actions={[
                                {
                                  icon: <Trash2 className="h-5 w-5" />,
                                  ariaLabel: "Delete duty",
                                  variant: "destructive",
                                  onClick: () => handleDeleteDuty(entry),
                                },
                              ]}
                            >
                              <DutyEntryCard
                                entry={entry}
                                activation={activations.get(entry.id) ?? null}
                                onClick={() => openEditDuty(entry)}
                                compact
                              />
                            </SwipeableCard>
                          ))}
                        </div>
                      </FormSection>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      </div>
      </PageContainer>

      <DutyEntryDialog
        // Remount on the entry so the form re-seeds from its `useState`
        // initialisers — no seeding effect, and no risk of a reactive rewrite
        // of the same row clobbering an edit in progress.
        key={editingEntry?.id ?? "new"}
        open={dutyDialogOpen}
        entry={editingEntry}
        onClose={() => setDutyDialogOpen(false)}
        onSaved={handleDutySaved}
      />
    </>
  )
}
