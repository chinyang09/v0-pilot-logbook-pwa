"use client"

import { useState, useMemo, useCallback } from "react"
import { useSessionState } from "@/hooks/use-session-state"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassContainer } from "@/components/ui/glass-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Calendar as CalendarIcon,
  AlertCircle,
  RefreshCw,
  List,
  CalendarDays,
  Shield,
  TrendingUp,
  ArrowRight,
} from "lucide-react"
import { useScheduleEntries, useCurrencies, useDiscrepancyCounts, refreshAllData } from "@/hooks/data"
import type { ScheduleEntry } from "@/types"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { DutyEntryCard, RosterCalendar } from "@/components/roster"
import { FastScroll, generateDateItems } from "@/components/ui/fast-scroll"
import { UnifiedImportButton } from "@/components/import/unified-import-button"

type ViewMode = "list" | "calendar"

export default function RosterPage() {
  const [viewMode, setViewMode] = useSessionState<ViewMode>("roster:viewMode", "list")
  const [selectedDate, setSelectedDate] = useSessionState<string | null>("roster:selectedDate", null)
  const [selectedEntries, setSelectedEntries] = useState<ScheduleEntry[]>([])

  const { scheduleEntries, isLoading: entriesLoading, refresh: refreshEntries } = useScheduleEntries()
  const { currencies } = useCurrencies()
  const { counts: discrepancyCounts } = useDiscrepancyCounts()

  // Group schedule entries by date
  const entriesByDate = scheduleEntries.reduce(
    (acc, entry) => {
      if (!acc[entry.date]) {
        acc[entry.date] = []
      }
      acc[entry.date].push(entry)
      return acc
    },
    {} as Record<string, typeof scheduleEntries>
  )

  const sortedDates = Object.keys(entriesByDate).sort((a, b) => b.localeCompare(a))

  // Generate FastScroll items from dates
  const fastScrollItems = useMemo(() => {
    return generateDateItems(sortedDates);
  }, [sortedDates]);

  const [activeMonthKey, setActiveMonthKey] = useState<string | undefined>(undefined);

  const handleFastScrollSelect = useCallback((monthYear: string) => {
    setActiveMonthKey(monthYear);

    const [targetYear, targetMonth] = monthYear.split("-");
    const targetDate = sortedDates.find((date) => {
      const [year, month] = date.split("-");
      return year === targetYear && month === targetMonth;
    });

    if (targetDate) {
      const element = document.getElementById(`roster-date-${targetDate}`);
      if (element) {
        element.scrollIntoView({ behavior: "instant", block: "start" });
      }
    }
  }, [sortedDates]);

  const handleDateClick = (date: string, entries: ScheduleEntry[]) => {
    setSelectedDate(date)
    setSelectedEntries(entries)
    setViewMode("list")
  }

  const handleBackToCalendar = () => {
    setSelectedDate(null)
    setSelectedEntries([])
  }

  // Glass action buttons for the floating header bar
  const rosterActions = useMemo(() => (
    <>
      <GlassContainer cornerRadius={28}>
        <div className="flex items-center gap-0.5 px-1 h-14">
          <Button variant="ghost" size="icon" className="h-12 w-12" onClick={() => refreshEntries()} disabled={entriesLoading}>
            <RefreshCw className={cn("h-5 w-5", entriesLoading && "animate-spin")} />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-12 w-12"
            onClick={() => setViewMode("list")}
          >
            <List className="h-5 w-5" />
          </Button>
          <Button
            variant={viewMode === "calendar" ? "secondary" : "ghost"}
            size="icon"
            className="h-12 w-12"
            onClick={() => setViewMode("calendar")}
          >
            <CalendarDays className="h-5 w-5" />
          </Button>
        </div>
      </GlassContainer>
      <GlassContainer cornerRadius={28}>
        <div className="flex items-center gap-0.5 px-1 h-14">
          <UnifiedImportButton
            context="roster"
            onComplete={() => {
              refreshEntries()
              refreshAllData()
            }}
          />
        </div>
      </GlassContainer>
    </>
  ), [refreshEntries, entriesLoading, viewMode])

  useRegisterMainActions(rosterActions, true)

  return (
    <>
      <PageContainer>
        <div className="px-4 pt-4 pb-safe space-y-4">

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
              <div className="text-2xl font-bold text-yellow-500">{discrepancyCounts.unresolved}</div>
              <div className="text-xs text-muted-foreground">Discrepancies</div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Access Navigation */}
        {scheduleEntries.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <Link href="/currencies">
              <Card className="hover:bg-secondary/50 transition-colors cursor-pointer">
                <CardContent className="pt-4 pb-3 px-3">
                  <div className="flex items-center justify-between mb-1">
                    <Shield className="h-5 w-5 text-green-500" />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="text-xs font-medium">Currencies</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/discrepancies">
              <Card className="hover:bg-secondary/50 transition-colors cursor-pointer">
                <CardContent className="pt-4 pb-3 px-3">
                  <div className="flex items-center justify-between mb-1">
                    <AlertCircle className="h-5 w-5 text-yellow-500" />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="text-xs font-medium">Discrepancies</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/fdp">
              <Card className="hover:bg-secondary/50 transition-colors cursor-pointer">
                <CardContent className="pt-4 pb-3 px-3">
                  <div className="flex items-center justify-between mb-1">
                    <TrendingUp className="h-5 w-5 text-blue-500" />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="text-xs font-medium">FDP Dashboard</div>
                </CardContent>
              </Card>
            </Link>
          </div>
        )}

        {/* Empty State */}
        {scheduleEntries.length === 0 && !entriesLoading && (
          <Card>
            <CardContent className="py-12 text-center">
              <CalendarIcon className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">No Schedule Data</p>
              <p className="text-xs text-muted-foreground max-w-[240px] mx-auto mb-4">
                Use the upload button above to import your Crew Logbook or Schedule report (CSV/PDF).
              </p>
            </CardContent>
          </Card>
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
                    ← Back to Calendar
                  </Button>
                  <h2 className="text-lg font-semibold">
                    {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </h2>
                </div>
                {selectedEntries.map((entry) => (
                  <DutyEntryCard key={entry.id} entry={entry} />
                ))}
              </>
            ) : (
              <>
                {/* All Dates List */}
                {sortedDates.slice(0, 30).map((date) => (
                  <Card key={date} id={`roster-date-${date}`}>
                    <CardHeader className="pb-2 pt-3 px-3">
                      <CardTitle className="text-sm font-medium">
                        {new Date(date + "T00:00:00").toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3 space-y-2">
                      {entriesByDate[date].map((entry) => (
                        <DutyEntryCard key={entry.id} entry={entry} compact />
                      ))}
                    </CardContent>
                  </Card>
                ))}
                {sortedDates.length > 30 && (
                  <p className="text-center text-sm text-muted-foreground">
                    Showing 30 most recent days. {sortedDates.length - 30} more days available.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* FastScroll rail - fixed position */}
        {viewMode === "list" && !selectedDate && fastScrollItems.length > 1 && (
          <div className="fixed right-1 top-1/2 -translate-y-1/2 z-40">
            <FastScroll
              items={fastScrollItems}
              activeKey={activeMonthKey}
              onSelect={handleFastScrollSelect}
              indicatorPosition="left"
            />
          </div>
        )}
      </div>
      </PageContainer>
    </>
  )
}
