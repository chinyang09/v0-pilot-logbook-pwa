"use client"

import { Component, useMemo, useState, useEffect, useCallback, type ReactNode, type ErrorInfo } from "react"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassContainer } from "@/components/ui/glass-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Calculator,
  ChevronDown,
} from "lucide-react"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { useScheduleEntries } from "@/hooks/data/use-schedule"
import {
  DEFAULT_FTL_LIMITS,
  FTL_PRESETS,
  type FTLLimits,
  type RegulationType,
} from "@/types/entities/roster.types"
import { FDPTimelineChart } from "@/components/roster/fdp-timeline-chart"
import { QuickCheckPanel } from "@/components/roster/quick-check-panel"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import type { ScenarioResult } from "@/lib/utils/roster/fdp-calculator"
import { cn } from "@/lib/utils"

/** Error boundary around the chart — prevents Recharts crashes from taking down the page */
class ChartErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[FDP] Chart render error:", error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <CardContent className="py-6 text-center">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/40 mb-2 mx-auto" />
            <p className="text-xs font-medium text-foreground mb-1">Chart failed to render</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="text-[10px] text-primary hover:underline"
            >
              Tap to retry
            </button>
          </CardContent>
        </Card>
      )
    }
    return this.props.children
  }
}

/** Format minutes as "Xh Ym" */
function formatMinutesHM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const RULE_DESCRIPTIONS: Record<string, string> = {
  "3a": "10h rest (local night)",
  "3b": "12h rest (no local night)",
  "3c": "rest matching duty hours",
  "3d": "24h rest (>16h duty)",
}

const REGULATION_LABELS: Record<RegulationType, string> = {
  CAAS: "CAAS",
  FAA: "FAA",
  EASA: "EASA",
  CUSTOM: "Custom",
}

export default function FDPPage() {
  const { refresh, isLoading: scheduleLoading } = useScheduleEntries()
  const {
    allDutyPeriods,
    capacity,
    forecast,
    restViolations,
    restUntilLegal,
    timelineData,
    isLoading,
  } = useFDPData()

  const { setDetailContent, setHasDetailSupport, setSelectedId } = useDetailPanel()
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [quickCheckOpen, setQuickCheckOpen] = useState(false)
  const [ruleMenuOpen, setRuleMenuOpen] = useState(false)
  const [activeRule, setActiveRule] = useState<RegulationType>("CAAS")
  const [customLimits, setCustomLimits] = useState<FTLLimits>(DEFAULT_FTL_LIMITS)

  // Register detail panel support
  useEffect(() => {
    setHasDetailSupport(true)
    return () => setHasDetailSupport(false)
  }, [setHasDetailSupport])

  const activeLimits = useMemo(() => {
    if (activeRule === "CUSTOM") return customLimits
    return FTL_PRESETS[activeRule]
  }, [activeRule, customLimits])

  const handleRuleChange = useCallback((rule: RegulationType) => {
    setActiveRule(rule)
    if (rule !== "CUSTOM") {
      setCustomLimits(FTL_PRESETS[rule])
    }
    setRuleMenuOpen(false)
  }, [])

  // Open/close quick check panel in detail panel
  const closeQuickCheck = useCallback(() => {
    setQuickCheckOpen(false)
    setScenarioResult(null)
    setDetailContent(null)
    setSelectedId(null)
  }, [setDetailContent, setSelectedId])

  // "View Chart" dismisses mobile overlay but keeps scenario result
  const handleViewChart = useCallback(() => {
    setSelectedId(null)
  }, [setSelectedId])

  useEffect(() => {
    if (quickCheckOpen) {
      setDetailContent(
        <QuickCheckPanel
          dutyPeriods={allDutyPeriods}
          limits={activeLimits}
          onScenarioResult={setScenarioResult}
          onClose={closeQuickCheck}
          onViewChart={handleViewChart}
        />
      )
      setSelectedId("legal-check")
    } else {
      setDetailContent(null)
      setSelectedId(null)
    }
  }, [quickCheckOpen, allDutyPeriods, activeLimits, closeQuickCheck, handleViewChart, setDetailContent, setSelectedId])

  // Live digital countdown — updates every 10 seconds
  const [countdown, setCountdown] = useState("")
  useEffect(() => {
    if (!restUntilLegal) return
    const update = () => {
      const legalAt = new Date(restUntilLegal.legalAtUtc).getTime()
      const remaining = Math.max(0, legalAt - Date.now())
      const h = Math.floor(remaining / 3600000)
      const m = Math.floor((remaining % 3600000) / 60000)
      setCountdown(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`)
    }
    update()
    if (restUntilLegal.isLegalNow) return
    const interval = setInterval(update, 10_000)
    return () => clearInterval(interval)
  }, [restUntilLegal])

  // Header actions: refresh + quick check
  const fdpActions = useMemo(
    () => (
      <div className="flex gap-2">
        <GlassContainer cornerRadius={28}>
          <Button
            variant="ghost"
            size="icon"
            className="h-14 w-14"
            onClick={() => setQuickCheckOpen((prev) => !prev)}
          >
            <Calculator className={cn("h-5 w-5", quickCheckOpen && "text-primary")} />
          </Button>
        </GlassContainer>
        <GlassContainer cornerRadius={28}>
          <Button
            variant="ghost"
            size="icon"
            className="h-14 w-14"
            onClick={() => refresh()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
          </Button>
        </GlassContainer>
      </div>
    ),
    [refresh, isLoading, quickCheckOpen]
  )

  useRegisterMainActions(fdpActions, true)

  return (
    <PageContainer>
      <div className="px-4 pt-2 pb-safe space-y-2">
        {/* Rule selector + Rest countdown row */}
        <div className="flex items-stretch gap-2">
          {/* Rule selector chip */}
          <div className="relative shrink-0">
            <button
              onClick={() => setRuleMenuOpen(!ruleMenuOpen)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-medium h-full"
            >
              {REGULATION_LABELS[activeRule]}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {ruleMenuOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[100px]">
                {(["CAAS", "FAA", "EASA"] as RegulationType[]).map((rule) => (
                  <button
                    key={rule}
                    onClick={() => handleRuleChange(rule)}
                    className={cn(
                      "block w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors",
                      activeRule === rule && "font-semibold text-primary"
                    )}
                  >
                    {REGULATION_LABELS[rule]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Rest Until Legal — inline compact */}
          {restUntilLegal && (
            <Card
              className={cn(
                "flex-1 border",
                restUntilLegal.isLegalNow
                  ? "border-green-500/20 bg-green-500/5"
                  : "border-red-500/20 bg-red-500/5"
              )}
            >
              <CardContent className="py-1.5 px-2.5">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "text-lg font-mono font-bold tabular-nums leading-none",
                    restUntilLegal.isLegalNow ? "text-green-500" : "text-red-500"
                  )}>
                    {restUntilLegal.isLegalNow ? "00:00" : countdown}
                  </div>
                  <div className="flex-1 min-w-0 border-l border-border pl-2">
                    {restUntilLegal.isLegalNow ? (
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        LEGAL · {formatMinutesHM(restUntilLegal.restElapsedMinutes)} since last duty
                      </p>
                    ) : (
                      <p className="text-[10px] text-foreground leading-tight">
                        Legal at {new Date(restUntilLegal.legalAtUtc).toISOString().slice(11, 16)}Z
                        <span className="text-muted-foreground">
                          {" · "}{RULE_DESCRIPTIONS[restUntilLegal.rule] ?? restUntilLegal.rule}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Warnings — compact inline */}
        {(restViolations.length > 0 || forecast.hasExceedance) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1">
            {restViolations.length > 0 && (
              <div className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-red-500" />
                <span className="text-[10px] text-red-500">
                  {restViolations.length} rest violation{restViolations.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
            {forecast.hasExceedance && (
              <div className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-orange-500" />
                <span className="text-[10px] text-orange-500">
                  Breach forecast
                </span>
              </div>
            )}
          </div>
        )}

        {/* Interactive Timeline Chart — tabs integrated into card */}
        {timelineData.length > 0 ? (
          <ChartErrorBoundary>
            <FDPTimelineChart
              timelineData={timelineData}
              limits={activeLimits}
              capacity={capacity}
              forecast={forecast}
              scenarioTimelineData={scenarioResult?.timelineData}
              scenarioModifiedDates={scenarioResult?.modifiedDates}
              scenarioRemovedDates={scenarioResult?.removedDates}
            />
          </ChartErrorBoundary>
        ) : !isLoading ? (
          <Card>
            <CardContent className="py-6 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground/40 mb-2 mx-auto" />
              <p className="text-xs font-medium text-foreground mb-0.5">No Duty Periods</p>
              <p className="text-[10px] text-muted-foreground max-w-[200px] mx-auto">
                Import schedule or log flights to see FDP compliance.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageContainer>
  )
}
