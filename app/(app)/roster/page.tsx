"use client"

import { useState, useRef } from "react"
import { PageContainer } from "@/components/page-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Calendar,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  Plane,
  Coffee,
  GraduationCap,
  XCircle,
  RefreshCw,
} from "lucide-react"
import { parseScheduleCSV, detectCSVType } from "@/lib/utils/parsers"
import { useScheduleEntries, useCurrencies, useDiscrepancyCounts, refreshAllData } from "@/hooks/data"
import type { ScheduleImportResult, DutyType } from "@/types"
import { cn } from "@/lib/utils"

const DUTY_TYPE_ICONS: Record<DutyType, typeof Plane> = {
  flight: Plane,
  standby: Clock,
  training: GraduationCap,
  leave: Calendar,
  off: Coffee,
  ground: FileText,
  positioning: Plane,
  other: FileText,
}

const DUTY_TYPE_COLORS: Record<DutyType, string> = {
  flight: "bg-blue-500/10 text-blue-500",
  standby: "bg-yellow-500/10 text-yellow-500",
  training: "bg-purple-500/10 text-purple-500",
  leave: "bg-green-500/10 text-green-500",
  off: "bg-gray-500/10 text-gray-500",
  ground: "bg-orange-500/10 text-orange-500",
  positioning: "bg-cyan-500/10 text-cyan-500",
  other: "bg-gray-500/10 text-gray-500",
}

export default function RosterPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importStage, setImportStage] = useState("")
  const [importResult, setImportResult] = useState<ScheduleImportResult | null>(null)

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

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-12">
              <h1 className="text-lg font-semibold text-foreground">Roster</h1>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refreshEntries()}
                  disabled={entriesLoading}
                >
                  <RefreshCw className={cn("h-4 w-4", entriesLoading && "animate-spin")} />
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

        {/* Empty State */}
        {scheduleEntries.length === 0 && !entriesLoading && !isImporting && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
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

        {/* Schedule Entries List */}
        {sortedDates.length > 0 && (
          <div className="space-y-3">
            {sortedDates.slice(0, 30).map((date) => (
              <Card key={date}>
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
                  {entriesByDate[date].map((entry) => {
                    const Icon = DUTY_TYPE_ICONS[entry.dutyType] || FileText
                    const colorClass = DUTY_TYPE_COLORS[entry.dutyType] || DUTY_TYPE_COLORS.other

                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 p-2 rounded-lg bg-secondary/30"
                      >
                        <div className={cn("p-2 rounded-lg", colorClass)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {entry.dutyCode || entry.dutyType}
                          </div>
                          {entry.dutyDescription && (
                            <div className="text-xs text-muted-foreground truncate">
                              {entry.dutyDescription}
                            </div>
                          )}
                          {entry.sectors.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {entry.sectors
                                .map((s) => `${s.departureIata}-${s.arrivalIata}`)
                                .join(", ")}
                            </div>
                          )}
                        </div>
                        {entry.reportTime && (
                          <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary/50">
                            {entry.reportTime}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            ))}
            {sortedDates.length > 30 && (
              <p className="text-center text-sm text-muted-foreground">
                Showing 30 most recent days. {sortedDates.length - 30} more days available.
              </p>
            )}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
