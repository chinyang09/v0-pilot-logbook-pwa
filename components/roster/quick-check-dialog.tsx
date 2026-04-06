"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CheckCircle2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { simulateHypotheticalDuty } from "@/lib/utils/roster/fdp-calculator"
import type { QuickCheckResult } from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import type { DutyPeriod } from "@/types/entities/roster.types"

interface QuickCheckDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dutyPeriods: DutyPeriod[]
}

function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split("T")[0]
}

function CheckRow({
  label,
  value,
  compliant,
}: {
  label: string
  value: string
  compliant: boolean
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-1.5">
        {compliant ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        )}
        <span className="text-xs">{label}</span>
      </div>
      <span className={cn("text-xs tabular-nums font-medium", !compliant && "text-red-500")}>
        {value}
      </span>
    </div>
  )
}

const RULE_LABELS: Record<string, string> = {
  "3a": "3(a)",
  "3b": "3(b)",
  "3c": "3(c)",
  "3d": "3(d)",
}

export function QuickCheckDialog({ open, onOpenChange, dutyPeriods }: QuickCheckDialogProps) {
  const [date, setDate] = useState(tomorrow)
  const [reportTime, setReportTime] = useState("06:00")
  const [debriefTime, setDebriefTime] = useState("14:00")
  const [flightHours, setFlightHours] = useState("6")
  const [sectors, setSectors] = useState("2")
  const [result, setResult] = useState<QuickCheckResult | null>(null)

  const handleCheck = useCallback(() => {
    const fh = parseFloat(flightHours) || 0
    const sc = parseInt(sectors) || 1

    const res = simulateHypotheticalDuty(
      dutyPeriods,
      {
        date,
        reportTime,
        debriefTime,
        flightMinutes: Math.round(fh * 60),
        sectorCount: sc,
      },
      DEFAULT_FTL_LIMITS
    )
    setResult(res)
  }, [dutyPeriods, date, reportTime, debriefTime, flightHours, sectors])

  const handleReset = useCallback(() => {
    setResult(null)
    setDate(tomorrow())
    setReportTime("06:00")
    setDebriefTime("14:00")
    setFlightHours("6")
    setSectors("2")
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xs max-h-[85vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="pb-0">
          <DialogTitle className="text-sm">Quick Legality Check</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {/* Compact form — 2×2 grid */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="qc-date" className="text-[10px] text-muted-foreground">Date</Label>
              <Input
                id="qc-date"
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setResult(null) }}
                className="mt-0.5 h-8 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="qc-report" className="text-[10px] text-muted-foreground">Report</Label>
              <Input
                id="qc-report"
                type="time"
                value={reportTime}
                onChange={(e) => { setReportTime(e.target.value); setResult(null) }}
                className="mt-0.5 h-8 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="qc-debrief" className="text-[10px] text-muted-foreground">Debrief</Label>
              <Input
                id="qc-debrief"
                type="time"
                value={debriefTime}
                onChange={(e) => { setDebriefTime(e.target.value); setResult(null) }}
                className="mt-0.5 h-8 text-xs"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="qc-flight" className="text-[10px] text-muted-foreground">Flight (h)</Label>
              <Input
                id="qc-flight"
                type="number"
                step="0.5"
                min="0"
                inputMode="decimal"
                value={flightHours}
                onChange={(e) => { setFlightHours(e.target.value); setResult(null) }}
                className="mt-0.5 h-8 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="qc-sectors" className="text-[10px] text-muted-foreground">Sectors</Label>
              <Input
                id="qc-sectors"
                type="number"
                min="1"
                inputMode="numeric"
                value={sectors}
                onChange={(e) => { setSectors(e.target.value); setResult(null) }}
                className="mt-0.5 h-8 text-xs"
              />
            </div>
          </div>

          <Button onClick={handleCheck} className="w-full h-8 text-xs" size="sm">
            Check
          </Button>

          {/* Results */}
          {result && (
            <div className="space-y-1.5">
              {/* Overall verdict */}
              <div className={cn(
                "rounded-md py-1.5 text-center font-semibold text-xs",
                result.overallCompliant
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-red-500/10 text-red-600 dark:text-red-400"
              )}>
                {result.overallCompliant ? "LEGAL" : "VIOLATION"}
              </div>

              {/* Individual checks — compact */}
              <div className="divide-y divide-border">
                {result.restBefore && (
                  <CheckRow
                    label={`Rest (${RULE_LABELS[result.restBefore.rule] ?? result.restBefore.rule})`}
                    value={`${(result.restBefore.restMinutes / 60).toFixed(1)} / ${(result.restBefore.requiredRestMinutes / 60).toFixed(0)}h`}
                    compliant={result.restBefore.compliant}
                  />
                )}
                <CheckRow
                  label="FDP"
                  value={`${(result.maxFdp.dutyMinutes / 60).toFixed(1)} / ${(result.maxFdp.maxFdpMinutes / 60).toFixed(1)}h`}
                  compliant={result.maxFdp.compliant}
                />
                <CheckRow
                  label="14d Duty"
                  value={`${result.duty14Days.projected.toFixed(1)} / ${result.duty14Days.limit}h`}
                  compliant={result.duty14Days.compliant}
                />
                <CheckRow
                  label="28d Duty"
                  value={`${result.duty28Days.projected.toFixed(1)} / ${result.duty28Days.limit}h`}
                  compliant={result.duty28Days.compliant}
                />
                <CheckRow
                  label="28d Flight"
                  value={`${result.flight28Days.projected.toFixed(1)} / ${result.flight28Days.limit}h`}
                  compliant={result.flight28Days.compliant}
                />
                <CheckRow
                  label="12mo Flight"
                  value={`${result.flight365Days.projected.toFixed(1)} / ${result.flight365Days.limit}h`}
                  compliant={result.flight365Days.compliant}
                />
              </div>

              <Button variant="ghost" onClick={handleReset} className="w-full h-7 text-[10px] text-muted-foreground" size="sm">
                Reset
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
