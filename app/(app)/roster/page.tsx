"use client"

import { useState, useRef, useMemo, useCallback } from "react"
import { PageContainer } from "@/components/page-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Calendar as CalendarIcon,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  List,
  CalendarDays,
  Settings,
  FileDown,
  Shield,
  TrendingUp,
  ArrowRight,
} from "lucide-react"
import { parseScheduleCSV, detectCSVType } from "@/lib/utils/parsers"
import { useScheduleEntries, useCurrencies, useDiscrepancyCounts, refreshAllData } from "@/hooks/data"
import type { ScheduleImportResult, ScheduleEntry } from "@/types"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { DutyEntryCard, RosterCalendar, DraftSettings } from "@/components/roster"
import { getDraftGenerationConfig } from "@/lib/db"
import { processPendingDrafts } from "@/lib/utils/roster/draft-generator"
import { FastScroll, generateDateItems, type FastScrollItem } from "@/components/ui/fast-scroll"

type ViewMode = "list" | "calendar"

export default function RosterPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importStage, setImportStage] = useState("")
  const [importResult, setImportResult] = useState<ScheduleImportResult | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("list")
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedEntries, setSelectedEntries] = useState<ScheduleEntry[]>([])
  const [isGeneratingDrafts, setIsGeneratingDrafts] = useState(false)
  const [draftResult, setDraftResult] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const { scheduleEntries, isLoading: entriesLoading, refresh: refreshEntries } = useScheduleEntries()
  const { currencies, isLoading: currenciesLoading } = useCurrencies()
  const { counts: discrepancyCounts } = useDiscrepancyCounts()

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    setImportProgress(0)
    setImportStage("Reading file...")
    setImportResult(null)

    try {
      const content = await file.text()
      const csvType = detectCSVType(content)

      if (csvType !== "schedule") {
        setImportResult({
          success: false,
          entriesCreated: 0,
          entriesUpdated: 0,
          entriesSkipped: 0,
          draftsCreated: 0,
          currenciesUpdated: 0,
          personnelCreated: 0,
          discrepancies: [],
          errors: [
            {
              line: 0,
              message:
                csvType === "logbook"
                  ? "This appears to be a Logbook CSV. Please use the Data Import page for logbook data."
                  : "Unrecognized CSV format. Please use a Scoot Personal Crew Schedule Report.",
            },
          ],
          warnings: [],
          timeReference: "UTC",
          dateRange: { start: "", end: "" },
          crewMember: { crewId: "", name: "", base: "", role: "", aircraftType: "" },
        })
        return
      }

      const result = await parseScheduleCSV(content, {
        onProgress: (percent, stage, detail) => {
          setImportProgress(percent)
          setImportStage(detail || stage)
        },
        sourceFile: file.name,
      })

      setImportResult(result)

      if (result.success) {
        await refreshEntries()
        await refreshAllData()
      }
    } catch (error) {
      console.error("Import error:", error)
      setImportResult({
        success: false,
        entriesCreated: 0,
        entriesUpdated: 0,
        entriesSkipped: 0,
        draftsCreated: 0,
        currenciesUpdated: 0,
        personnelCreated: 0,
        discrepancies: [],
        errors: [
          {
            line: 0,
            message: error instanceof Error ? error.message : "Unknown error occurred",
          },
        ],
        warnings: [],
        timeReference: "UTC",
        dateRange: { start: "", end: "" },
        crewMember: { crewId: "", name: "", base: "", role: "", aircraftType: "" },
      })
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

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

  // Handle FastScroll selection
  const handleFastScrollSelect = useCallback((monthYear: string) => {
    setActiveMonthKey(monthYear);

    // Find the first date in this month/year
    const [targetYear, targetMonth] = monthYear.split("-");
    const targetDate = sortedDates.find((date) => {
      const [year, month] = date.split("-");
      return year === targetYear && month === targetMonth;
    });

    if (targetDate) {
      // Scroll to the element
      const element = document.getElementById(`roster-date-${targetDate}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const handleGenerateDrafts = async () => {
    try {
      setIsGeneratingDrafts(true)
      setDraftResult(null)

      const config = await getDraftGenerationConfig()
      const result = await processPendingDrafts(config)

      if (result.created > 0) {
        setDraftResult(`Created ${result.created} draft flight(s) from ${result.entriesProcessed.length} schedule entry(ies)`)
        await refreshAllData()
      } else {
        setDraftResult("No new drafts to create")
      }

      setTimeout(() => setDraftResult(null), 5000)
    } catch (error) {
      console.error("Failed to generate drafts:", error)
      setDraftResult("Failed to generate drafts")
      setTimeout(() => setDraftResult(null), 5000)
    } finally {
      setIsGeneratingDrafts(false)
    }
  }

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-12">
              <h1 className="text-lg font-semibold text-foreground">Roster</h1>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => refreshEntries()}
                  disabled={entriesLoading}
                  title="Refresh"
                >
                  <RefreshCw className={cn("h-4 w-4", entriesLoading && "animate-spin")} />
                </Button>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setViewMode("list")}
                  title="List View"
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "calendar" ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setViewMode("calendar")}
                  title="Calendar View"
                >
                  <CalendarDays className="h-4 w-4" />
                </Button>
                <Dialog open={showSettings} onOpenChange={setShowSettings}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon-sm" title="Draft Settings">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Draft Generation Settings</DialogTitle>
                      <DialogDescription>
                        Configure automatic draft flight generation from your schedule
                      </DialogDescription>
                    </DialogHeader>
                    <DraftSettings onSave={() => setShowSettings(false)} />
                  </DialogContent>
                </Dialog>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerateDrafts}
                  disabled={isGeneratingDrafts}
                  title="Generate Drafts"
                >
                  <FileDown className={cn("h-4 w-4", isGeneratingDrafts && "animate-bounce")} />
                </Button>
                <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                  <Upload className="h-4 w-4 mr-1" />
                  Import
                </Button>
              </div>
            </div>
          </div>
        </header>
      }
    >
      <div className="container mx-auto px-3 pt-4 pb-safe space-y-4">
        <input
          type="file"
          ref={fileInputRef}
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Draft Generation Result */}
        {draftResult && (
          <Card className="border-blue-500/50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-blue-500" />
                <span>{draftResult}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Import Progress */}
        {isImporting && (
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{importStage}</span>
                  <span className="font-medium">{importProgress}%</span>
                </div>
                <Progress value={importProgress} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Import Result */}
        {importResult && (
          <Card className={importResult.success ? "border-green-500/50" : "border-destructive/50"}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {importResult.success ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    Import Successful
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-destructive" />
                    Import Failed
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {importResult.success ? (
                <div className="space-y-2 text-sm">
                  <p>
                    <span className="font-medium">{importResult.entriesCreated}</span> entries created,{" "}
                    <span className="font-medium">{importResult.entriesUpdated}</span> updated
                  </p>
                  {importResult.draftsCreated > 0 && (
                    <p>
                      <span className="font-medium">{importResult.draftsCreated}</span> flights created
                      from actual times
                    </p>
                  )}
                  {importResult.currenciesUpdated > 0 && (
                    <p>
                      <span className="font-medium">{importResult.currenciesUpdated}</span> currencies
                      updated
                    </p>
                  )}
                  {importResult.personnelCreated > 0 && (
                    <p>
                      <span className="font-medium">{importResult.personnelCreated}</span> crew members
                      added
                    </p>
                  )}
                  {importResult.discrepancies.length > 0 && (
                    <p className="text-yellow-600">
                      <AlertCircle className="h-4 w-4 inline mr-1" />
                      <span className="font-medium">{importResult.discrepancies.length}</span>{" "}
                      discrepancies found
                    </p>
                  )}
                  {importResult.dateRange.start && (
                    <p className="text-muted-foreground">
                      Period: {importResult.dateRange.start} to {importResult.dateRange.end}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  {importResult.errors.map((error, idx) => (
                    <p key={idx} className="text-destructive">
                      {error.message}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
        {scheduleEntries.length === 0 && !entriesLoading && !isImporting && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <CalendarIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <CardTitle className="text-lg mb-2">No Schedule Data</CardTitle>
              <CardDescription className="mb-4">
                Import your crew schedule CSV to view your roster and track duty times.
              </CardDescription>
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                Import Schedule CSV
              </Button>
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
  )
}
