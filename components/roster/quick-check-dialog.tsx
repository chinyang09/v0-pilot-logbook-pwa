"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CheckCircle2, XCircle, Calculator } from "lucide-react"
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
  projected,
  limit,
  unit,
  compliant,
}: {
  label: string
  projected: string
  limit: string
  unit: string
  compliant: boolean
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        {compliant ? (
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500 shrink-0" />
        )}
        <span className="text-sm">{label}</span>
      </div>
      <span className={cn("text-sm tabular-nums font-medium", !compliant && "text-red-500")}>
        {projected}{unit} / {limit}{unit}
      </span>
    </div>
  )
}

const RULE_LABELS: Record<string, string> = {
  "3a": "Reg 3(a)",
  "3b": "Reg 3(b)",
  "3c": "Reg 3(c)",
  "3d": "Reg 3(d)",
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Quick Legality Check
          </DialogTitle>
          <DialogDescription>
            Enter a hypothetical duty to check if it would breach any limits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Form */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="qc-date" className="text-xs text-muted-foreground">Date</Label>
              <Input
                id="qc-date"
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setResult(null) }}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="qc-report" className="text-xs text-muted-foreground">Report (UTC)</Label>
              <Input
                id="qc-report"
                type="time"
                value={reportTime}
                onChange={(e) => { setReportTime(e.target.value); setResult(null) }}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="qc-debrief" className="text-xs text-muted-foreground">Debrief (UTC)</Label>
              <Input
                id="qc-debrief"
                type="time"
                value={debriefTime}
                onChange={(e) => { setDebriefTime(e.target.value); setResult(null) }}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="qc-flight" className="text-xs text-muted-foreground">Flight time (h)</Label>
              <Input
                id="qc-flight"
                type="number"
                step="0.5"
                min="0"
                value={flightHours}
                onChange={(e) => { setFlightHours(e.target.value); setResult(null) }}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="qc-sectors" className="text-xs text-muted-foreground">Sectors</Label>
              <Input
                id="qc-sectors"
                type="number"
                min="1"
                value={sectors}
                onChange={(e) => { setSectors(e.target.value); setResult(null) }}
                className="mt-1"
              />
            </div>
          </div>

          <Button onClick={handleCheck} className="w-full">
            Check Legality
          </Button>

          {/* Results */}
          {result && (
            <div className="space-y-2">
              {/* Overall verdict */}
              <div className={cn(
                "rounded-lg p-3 text-center font-semibold text-sm",
                result.overallCompliant
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-red-500/10 text-red-600 dark:text-red-400"
              )}>
                {result.overallCompliant ? "LEGAL — All limits met" : "VIOLATION — Limit(s) breached"}
              </div>

              {/* Individual checks */}
              <div className="divide-y divide-border text-foreground">
                {/* Rest period */}
                {result.restBefore && (
                  <CheckRow
                    label={`Rest (${RULE_LABELS[result.restBefore.rule] ?? result.restBefore.rule})`}
                    projected={(result.restBefore.restMinutes / 60).toFixed(1)}
                    limit={(result.restBefore.requiredRestMinutes / 60).toFixed(0)}
                    unit="h"
                    compliant={result.restBefore.compliant}
                  />
                )}

                {/* Single duty FDP */}
                <CheckRow
                  label="Single FDP"
                  projected={(result.maxFdp.dutyMinutes / 60).toFixed(1)}
                  limit={(result.maxFdp.maxFdpMinutes / 60).toFixed(1)}
                  unit="h"
                  compliant={result.maxFdp.compliant}
                />

                {/* Rolling limits */}
                <CheckRow
                  label="14-Day Duty"
                  projected={result.duty14Days.projected.toFixed(1)}
                  limit={result.duty14Days.limit.toString()}
                  unit="h"
                  compliant={result.duty14Days.compliant}
                />
                <CheckRow
                  label="28-Day Duty"
                  projected={result.duty28Days.projected.toFixed(1)}
                  limit={result.duty28Days.limit.toString()}
                  unit="h"
                  compliant={result.duty28Days.compliant}
                />
                <CheckRow
                  label="28-Day Flight"
                  projected={result.flight28Days.projected.toFixed(1)}
                  limit={result.flight28Days.limit.toString()}
                  unit="h"
                  compliant={result.flight28Days.compliant}
                />
                <CheckRow
                  label="12-Mo Flight"
                  projected={result.flight365Days.projected.toFixed(1)}
                  limit={result.flight365Days.limit.toString()}
                  unit="h"
                  compliant={result.flight365Days.compliant}
                />
              </div>

              <Button variant="outline" onClick={handleReset} className="w-full" size="sm">
                Reset
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
