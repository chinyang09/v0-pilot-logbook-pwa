"use client"

import { useState, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/date-picker"
import { TimePicker } from "@/components/time-picker"
import {
  Plus,
  Trash2,
  ArrowLeftRight,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { simulateScenario } from "@/lib/utils/roster/fdp-calculator"
import type { ScenarioChange, ScenarioResult } from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import type { DutyPeriod, FTLLimits } from "@/types/entities/roster.types"
import { SegmentedTabs, type SegmentedTab } from "@/components/import/segmented-tabs"
import { DetailFormPanel } from "@/components/ui/detail-form-panel"

const noop = () => {}

const MODE_TABS: SegmentedTab<"add" | "swap">[] = [
  { value: "add", label: "Add a Duty" },
  { value: "swap", label: "Swap / Remove" },
]

interface QuickCheckPanelProps {
  dutyPeriods: DutyPeriod[]
  limits?: FTLLimits
  onScenarioResult?: (result: ScenarioResult | null) => void
}

/** Tomorrow's UTC date — the Quick Check's fields are UTC. Stepping the LOCAL
 *  date and then reading the UTC one gave today, east of UTC before 08:00. */
function tomorrow(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().split("T")[0]
}

const MONTH_UTC = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z")
  return `${d.getUTCDate().toString().padStart(2, "0")} ${MONTH_UTC.format(d)}`
}

const VIOLATION_TYPE_LABELS: Record<string, string> = {
  rest: "Rest",
  fdp: "FDP",
  duty14: "14d Duty",
  duty28: "28d Duty",
  flight28: "28d Flight",
  flight365: "12mo Flight",
}

/**
 * A compact field that opens the app's wheel picker — the same picker every
 * other date and time in the app uses. It was `<input type="date">` /
 * `type="time"`: the browser's own controls, boxed "mm/dd/yyyy" in the
 * browser's locale and with no word on which clock the time was in. The
 * scenario reads report and debrief as UTC, and the picker says so.
 */
function PickerField({
  kind,
  label,
  value,
  onChange,
}: {
  kind: "date" | "time"
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const shown = value ? (kind === "date" ? formatDateShort(value) : value) : "—"
  return (
    <div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${label}: ${value || "not set"}${kind === "time" ? " UTC" : ""}`}
        className="mt-0.5 flex h-9 w-full items-center rounded-md border border-input bg-transparent px-2 text-xs tabular-nums text-foreground transition-colors active:bg-muted/50"
      >
        {shown}
        {kind === "time" && value && <span className="ml-1 text-[10px] text-muted-foreground">Z</span>}
      </button>
      {open &&
        (kind === "date" ? (
          <DatePicker initialDate={value} onSelect={onChange} onClose={() => setOpen(false)} label={label} />
        ) : (
          <TimePicker initialTime={value} onSelect={onChange} onClose={() => setOpen(false)} label={label} />
        ))}
    </div>
  )
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
    // The same shell as every other detail form — one title (which rides the
    // header once scrolled away), one scroller, the chrome spacers. It used
    // to draw its own title bar with a "View Chart" button, which on a phone
    // did what Back does and on a tablet pointed at the chart beside it.
    <DetailFormPanel
      title="Legality Check"
      dirty={false}
      canSave={false}
      saving={false}
      onSave={noop}
      onCancel={noop}
    >
      <div className="space-y-3">
        {/* Mode selector — the app's segmented control, not two filled
            rectangles. And named for what each mode DOES to the roster: it
            said "Add Flight" here and again on the button below, which adds
            one more hypothetical duty in either mode. */}
        <SegmentedTabs
          tabs={MODE_TABS}
          value={mode}
          onChange={setMode}
        />

        {/* Swap mode: show future DPs to remove */}
        {mode === "swap" && futureDPs.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground">Tap scheduled duties to remove/swap:</p>
            {/* pr-1: lane for the overlay scrollbar so it doesn't draw over the
                right-aligned duty times (same fix as the dashboard flight list). */}
            <div className="max-h-[200px] overflow-y-auto space-y-1 pr-1">
              {futureDPs.map((dp) => {
                const isRemoved = removedDutyIds.has(dp.id)
                return (
                  <div key={dp.id} className="flex items-center gap-1.5">
                    <button
                      onClick={() => toggleRemoveDuty(dp.id, dp.date)}
                      className={cn(
                        "flex-1 flex h-9 items-center justify-between px-2 rounded text-xs transition-colors",
                        isRemoved ? "bg-status-error/10 text-status-error line-through" : "bg-secondary/50 text-foreground hover:bg-secondary"
                      )}
                    >
                      <span className="font-medium tabular-nums">{formatDateShort(dp.date)}</span>
                      <span className="tabular-nums">{dp.reportTime}–{dp.debriefTime} ({(dp.flightMinutes / 60).toFixed(1)}h)</span>
                    </button>
                    {isRemoved && (
                      <button
                        onClick={() => addSwap(dp.id, dp.date)}
                        className="control-surface shrink-0 flex h-9 w-9 items-center justify-center rounded-full"
                        title="Add replacement flight"
                        aria-label="Add replacement flight"
                      >
                        <ArrowLeftRight className="h-4 w-4" />
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
                    type="button"
                    aria-label="Remove this flight"
                    onClick={() => removeChange(entry.id)}
                    className="absolute top-0 right-0 flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:text-status-error transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <PickerField
                    kind="date"
                    label="Date"
                    value={entry.date}
                    onChange={(date) => updateChange(entry.id, { date })}
                  />
                  <PickerField
                    kind="time"
                    label="Report"
                    value={entry.reportTime}
                    onChange={(reportTime) => updateChange(entry.id, { reportTime })}
                  />
                  <PickerField
                    kind="time"
                    label="Debrief"
                    value={entry.debriefTime}
                    onChange={(debriefTime) => updateChange(entry.id, { debriefTime })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`qc-${entry.id}-flight`} className="text-[10px] text-muted-foreground">Flight (h)</Label>
                    <Input
                      id={`qc-${entry.id}-flight`}
                      type="number"
                      step="0.5"
                      min="0"
                      inputMode="decimal"
                      value={entry.flightHours}
                      onChange={(e) => updateChange(entry.id, { flightHours: e.target.value })}
                      className="h-9 text-xs px-2 mt-0.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`qc-${entry.id}-sectors`} className="text-[10px] text-muted-foreground">Sectors</Label>
                    <Input
                      id={`qc-${entry.id}-sectors`}
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={entry.sectors}
                      onChange={(e) => updateChange(entry.id, { sectors: e.target.value })}
                      className="h-9 text-xs px-2 mt-0.5"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5">
          <Button onClick={addChange} variant="outline" size="sm" className="flex-1 h-9 text-xs">
            <Plus className="h-3 w-3 mr-1" /> Another Duty
          </Button>
          <Button onClick={handleCheck} size="sm" className="flex-1 h-9 text-xs">
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

            <Button variant="outline" onClick={handleReset} className="w-full h-9 text-xs" size="sm">
              Reset
            </Button>
          </div>
        )}
      </div>
    </DetailFormPanel>
  )
}
