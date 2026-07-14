"use client"

import { useState, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Plus,
  Trash2,
  ArrowLeftRight,
  AlertTriangle,
  BarChart3,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { simulateScenario } from "@/lib/utils/roster/fdp-calculator"
import type { ScenarioChange, ScenarioResult } from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import type { DutyPeriod, FTLLimits } from "@/types/entities/roster.types"

interface QuickCheckPanelProps {
  dutyPeriods: DutyPeriod[]
  limits?: FTLLimits
  onScenarioResult?: (result: ScenarioResult | null) => void
  onClose?: () => void
  onViewChart?: () => void
}

function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split("T")[0]
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z")
  return `${d.getUTCDate().toString().padStart(2, "0")} ${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}`
}

const VIOLATION_TYPE_LABELS: Record<string, string> = {
  rest: "Rest",
  fdp: "FDP",
  duty14: "14d Duty",
  duty28: "28d Duty",
  flight28: "28d Flight",
  flight365: "12mo Flight",
}

let nextChangeId = 1

interface ChangeEntry {
  id: string
  type: "add" | "remove"
  date: string
  reportTime: string
  debriefTime: string
  flightHours: string
  sectors: string
  targetDutyId: string
}

function newAddEntry(): ChangeEntry {
  return {
    id: `c${nextChangeId++}`,
    type: "add",
    date: tomorrow(),
    reportTime: "06:00",
    debriefTime: "14:00",
    flightHours: "6",
    sectors: "2",
    targetDutyId: "",
  }
}

export function QuickCheckPanel({
  dutyPeriods,
  limits = DEFAULT_FTL_LIMITS,
  onScenarioResult,
  onClose,
  onViewChart,
}: QuickCheckPanelProps) {
  const [changes, setChanges] = useState<ChangeEntry[]>([newAddEntry()])
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const [mode, setMode] = useState<"add" | "swap">("add")

  const futureDPs = useMemo(
    () => dutyPeriods.filter((dp) => dp.isFuture).sort((a, b) => a.date.localeCompare(b.date)),
    [dutyPeriods]
  )

  const addChange = useCallback(() => {
    setChanges((prev) => [...prev, newAddEntry()])
    setResult(null)
  }, [])

  const removeChange = useCallback((id: string) => {
    setChanges((prev) => prev.filter((c) => c.id !== id))
    setResult(null)
  }, [])

  const updateChange = useCallback((id: string, updates: Partial<ChangeEntry>) => {
    setChanges((prev) => prev.map((c) => c.id === id ? { ...c, ...updates } : c))
    setResult(null)
  }, [])

  const addSwap = useCallback((dpId: string, dpDate: string) => {
    const removeEntry: ChangeEntry = {
      id: `c${nextChangeId++}`,
      type: "remove",
      date: dpDate,
      reportTime: "",
      debriefTime: "",
      flightHours: "",
      sectors: "",
      targetDutyId: dpId,
    }
    const addEntry = newAddEntry()
    setChanges((prev) => [...prev, removeEntry, addEntry])
    setResult(null)
  }, [])

  const toggleRemoveDuty = useCallback((dpId: string, dpDate: string) => {
    setChanges((prev) => {
      const existing = prev.find((c) => c.type === "remove" && c.targetDutyId === dpId)
      if (existing) {
        return prev.filter((c) => c.id !== existing.id)
      }
      return [...prev, {
        id: `c${nextChangeId++}`,
        type: "remove" as const,
        date: dpDate,
        reportTime: "",
        debriefTime: "",
        flightHours: "",
        sectors: "",
        targetDutyId: dpId,
      }]
    })
    setResult(null)
  }, [])

  const handleCheck = useCallback(() => {
    const scenarioChanges: ScenarioChange[] = changes.map((c) => ({
      id: c.id,
      type: c.type,
      date: c.date,
      reportTime: c.type === "add" ? c.reportTime : undefined,
      debriefTime: c.type === "add" ? c.debriefTime : undefined,
      flightMinutes: c.type === "add" ? Math.round((parseFloat(c.flightHours) || 0) * 60) : undefined,
      sectorCount: c.type === "add" ? (parseInt(c.sectors) || 1) : undefined,
      targetDutyId: c.type === "remove" ? c.targetDutyId : undefined,
    }))

    const res = simulateScenario(dutyPeriods, scenarioChanges, limits)
    setResult(res)
    onScenarioResult?.(res)
  }, [changes, dutyPeriods, limits, onScenarioResult])

  const handleReset = useCallback(() => {
    setChanges([newAddEntry()])
    setResult(null)
    onScenarioResult?.(null)
    setMode("add")
  }, [onScenarioResult])

  const removedDutyIds = useMemo(
    () => new Set(changes.filter((c) => c.type === "remove").map((c) => c.targetDutyId)),
    [changes]
  )

  const addEntries = changes.filter((c) => c.type === "add")

  return (
    <div className="flex flex-col h-full pt-16">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold">Legality Check</h2>
        {onViewChart && (
          <button
            onClick={onViewChart}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>View Chart</span>
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Mode selector */}
        <div className="flex gap-1">
          <button
            onClick={() => setMode("add")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors",
              mode === "add" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
            )}
          >
            <Plus className="h-3 w-3" /> Add Flight
          </button>
          <button
            onClick={() => setMode("swap")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors",
              mode === "swap" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
            )}
          >
            <ArrowLeftRight className="h-3 w-3" /> Swap / Remove
          </button>
        </div>

        {/* Swap mode: show future DPs to remove */}
        {mode === "swap" && futureDPs.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground">Tap scheduled duties to remove/swap:</p>
            <div className="max-h-[160px] overflow-y-auto space-y-0.5">
              {futureDPs.map((dp) => {
                const isRemoved = removedDutyIds.has(dp.id)
                return (
                  <div key={dp.id} className="flex items-center gap-1.5">
                    <button
                      onClick={() => toggleRemoveDuty(dp.id, dp.date)}
                      className={cn(
                        "flex-1 flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition-colors",
                        isRemoved ? "bg-status-error/10 text-status-error line-through" : "bg-secondary/50 text-foreground hover:bg-secondary"
                      )}
                    >
                      <span className="font-medium tabular-nums">{formatDateShort(dp.date)}</span>
                      <span className="tabular-nums">{dp.reportTime}–{dp.debriefTime} ({(dp.flightMinutes / 60).toFixed(1)}h)</span>
                    </button>
                    {isRemoved && (
                      <button
                        onClick={() => addSwap(dp.id, dp.date)}
                        className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        title="Add replacement flight"
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {mode === "swap" && futureDPs.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-2">No scheduled future duties to swap.</p>
        )}

        {/* Add entries */}
        {addEntries.length > 0 && (
          <div className="space-y-2">
            {addEntries.length > 1 && (
              <p className="text-[10px] text-muted-foreground">{addEntries.length} flights to add:</p>
            )}
            {addEntries.map((entry) => (
              <div key={entry.id} className="relative bg-secondary/30 rounded-md p-2.5 space-y-2">
                {addEntries.length > 1 && (
                  <button
                    onClick={() => removeChange(entry.id)}
                    className="absolute top-1.5 right-1.5 p-0.5 rounded text-muted-foreground hover:text-status-error transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Date</Label>
                    <Input
                      type="date"
                      value={entry.date}
                      onChange={(e) => updateChange(entry.id, { date: e.target.value })}
                      className="h-8 text-xs px-2 mt-0.5 appearance-none block w-full [&::-webkit-date-and-time-value]:text-left [&::-webkit-calendar-picker-indicator]:opacity-60"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Report</Label>
                    <Input
                      type="time"
                      value={entry.reportTime}
                      onChange={(e) => updateChange(entry.id, { reportTime: e.target.value })}
                      className="h-8 text-xs px-2 mt-0.5"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Debrief</Label>
                    <Input
                      type="time"
                      value={entry.debriefTime}
                      onChange={(e) => updateChange(entry.id, { debriefTime: e.target.value })}
                      className="h-8 text-xs px-2 mt-0.5"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Flight (h)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      inputMode="decimal"
                      value={entry.flightHours}
                      onChange={(e) => updateChange(entry.id, { flightHours: e.target.value })}
                      className="h-8 text-xs px-2 mt-0.5"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Sectors</Label>
                    <Input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={entry.sectors}
                      onChange={(e) => updateChange(entry.id, { sectors: e.target.value })}
                      className="h-8 text-xs px-2 mt-0.5"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5">
          <Button onClick={addChange} variant="outline" size="sm" className="flex-1 h-8 text-xs">
            <Plus className="h-3 w-3 mr-1" /> Add Flight
          </Button>
          <Button onClick={handleCheck} size="sm" className="flex-1 h-8 text-xs">
            Check Legality
          </Button>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-2">
            {/* Overall verdict */}
            <div className={cn(
              "rounded-md py-2 text-center font-semibold text-xs",
              result.overallLegal
                ? "bg-status-valid/10 text-status-valid"
                : "bg-status-error/10 text-status-error"
            )}>
              {result.overallLegal ? "ALL CHANGES LEGAL" : "VIOLATIONS DETECTED"}
            </div>

            {/* Violations list with type labels */}
            {result.violations.length > 0 && (
              <div className="space-y-1">
                {result.violations.map((v, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded bg-status-error/10">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3 text-status-error shrink-0" />
                      <span className="text-status-error font-medium">{formatDateShort(v.date)}</span>
                      <span className="text-status-error/80">{VIOLATION_TYPE_LABELS[v.type] ?? v.type}</span>
                    </div>
                    <span className="text-status-error tabular-nums font-medium">
                      {v.projected.toFixed(1)}h / {v.limit.toFixed(0)}h
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Summary of changes */}
            <div className="text-[10px] text-muted-foreground px-1">
              {result.modifiedDates.size > 0 && (
                <span>{result.modifiedDates.size} flight{result.modifiedDates.size !== 1 ? "s" : ""} added</span>
              )}
              {result.removedDates.size > 0 && (
                <span>{result.modifiedDates.size > 0 ? " · " : ""}{result.removedDates.size} removed</span>
              )}
            </div>

            <Button variant="ghost" onClick={handleReset} className="w-full h-7 text-[10px] text-muted-foreground" size="sm">
              Reset
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
