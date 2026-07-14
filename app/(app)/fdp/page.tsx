"use client"

import { Component, useMemo, useState, useEffect, useCallback, useRef, type ReactNode, type ErrorInfo } from "react"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import {
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Calculator,
} from "lucide-react"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { useScheduleEntries } from "@/hooks/data/use-schedule"
import { usePreferences } from "@/components/providers/preferences-provider"
import {
  FTL_PRESETS,
  type RegulationType,
} from "@/types/entities/roster.types"
import { FDPTimelineChart } from "@/components/roster/fdp-timeline-chart"
import { QuickCheckPanel } from "@/components/roster/quick-check-panel"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import type { ScenarioResult } from "@/lib/utils/roster/fdp-calculator"
import { cn } from "@/lib/utils"
import { formatMinutesHM, formatYMDShort as formatShortDate } from "@/lib/utils/date"

/** Error boundary around the chart — prevents Recharts crashes from taking down the page */
class ChartErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, errorMessage: "" }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error?.message ?? String(error) }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[FDP-chart] ✖ boundary caught", {
      message: error?.message,
      stack: error?.stack,
      componentStack: info?.componentStack,
    })
  }
  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <CardContent className="py-6 text-center">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/40 mb-2 mx-auto" />
            <p className="text-xs font-medium text-foreground mb-1">Chart failed to render</p>
            {this.state.errorMessage && (
              <p className="text-[10px] text-muted-foreground mb-2 max-w-[280px] mx-auto break-words">
                {this.state.errorMessage}
              </p>
            )}
            <button
              onClick={() => this.setState({ hasError: false, errorMessage: "" })}
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

/** Extract outbound destination from a route string like "WSSS-VVNB/VVNB-WSSS". */
function extractDestination(route?: string): string {
  if (!route) return ""
  const firstSector = route.split("/")[0] ?? ""
  const parts = firstSector.split("-")
  return parts[1]?.trim() ?? ""
}

export default function FDPPage() {
  const { refresh } = useScheduleEntries()
  const {
    allDutyPeriods,
    capacity,
    forecast,
    restViolations,
    futureDuties,
    restUntilLegal,
    timelineData,
    isLoading,
  } = useFDPData()

  const { preferences } = usePreferences()
  const activeRule: RegulationType = preferences.dutyTimeDefaults?.regulationType ?? "CAAS"

  const { selectedId, setDetailContent, setHasDetailSupport, setSelectedId } = useDetailPanel()
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [quickCheckOpen, setQuickCheckOpen] = useState(false)

  // Stable refs for detail panel setters — these change identity on every URL
  // update (setSelectedId is a useCallback with searchParams in deps, so
  // router.replace → searchParams → new setSelectedId ref). Including them
  // in effect deps causes an infinite setState loop ("Maximum update depth
  // exceeded") because the effect calls setSelectedId → URL changes →
  // setSelectedId new ref → effect reruns.
  const setDetailContentRef = useRef(setDetailContent)
  const setSelectedIdRef = useRef(setSelectedId)
  const setHasDetailSupportRef = useRef(setHasDetailSupport)
  useEffect(() => { setDetailContentRef.current = setDetailContent })
  useEffect(() => { setSelectedIdRef.current = setSelectedId })
  useEffect(() => { setHasDetailSupportRef.current = setHasDetailSupport })

  // Register detail panel support
  useEffect(() => {
    setHasDetailSupportRef.current(true)
    return () => setHasDetailSupportRef.current(false)
  }, [])

  const activeLimits = useMemo(
    () => FTL_PRESETS[activeRule] ?? FTL_PRESETS.CAAS,
    [activeRule]
  )

  // Open/close quick check panel in detail panel (stable ref via closure over refs)
  const closeQuickCheck = useCallback(() => {
    setQuickCheckOpen(false)
    setScenarioResult(null)
    setDetailContentRef.current(null)
    setSelectedIdRef.current(null)
  }, [])

  // "View Chart" dismisses mobile overlay but keeps scenario result
  const handleViewChart = useCallback(() => {
    setSelectedIdRef.current(null)
  }, [])

  // Sync quickCheckOpen → detail panel. Uses refs to avoid infinite loop
  // from unstable setSelectedId/setDetailContent dependencies.
  //
  // CRITICAL: `allDutyPeriods` is a new array reference every time `useFDPData`'s
  // memo recomputes (e.g. when airport timezones resolve, when SWR revalidates
  // flights or schedule). That happens on every data refresh. If we blindly called
  // setSelectedId(null)/setDetailContent(null) in the else branch on every such
  // re-run, each call would fire router.replace() → searchParams notification →
  // DetailPanelProvider layout effect → re-render → effect re-runs → … and
  // compound into React error #185 ("Maximum update depth exceeded"), which the
  // ChartErrorBoundary surfaces as "Chart failed to render".
  //
  // Fix: only run the open/close side effects when quickCheckOpen *transitions*,
  // and only refresh the panel content (when it is open) when its props change.
  const prevQuickCheckOpenRef = useRef(false)
  useEffect(() => {
    const wasOpen = prevQuickCheckOpenRef.current
    prevQuickCheckOpenRef.current = quickCheckOpen

    if (quickCheckOpen) {
      // Refresh panel content whenever relevant props change (dutyPeriods, limits, etc.)
      setDetailContentRef.current(
        <QuickCheckPanel
          dutyPeriods={allDutyPeriods}
          limits={activeLimits}
          onScenarioResult={setScenarioResult}
          onClose={closeQuickCheck}
          onViewChart={handleViewChart}
        />
      )
      // Only claim the detail-panel selection slot on the open transition.
      // Calling setSelectedId("legal-check") on every dep change would keep
      // firing router.replace even when nothing actually changed.
      if (!wasOpen) {
        setSelectedIdRef.current("legal-check")
      }
    } else if (wasOpen) {
      // Only tear down on the close transition — not on every allDutyPeriods
      // re-reference (which would cause the setState storm described above).
      setDetailContentRef.current(null)
      setSelectedIdRef.current(null)
    }
  }, [quickCheckOpen, allDutyPeriods, activeLimits, closeQuickCheck, handleViewChart])

  // Sync quickCheckOpen when selectedId is cleared externally (e.g., mobile back button).
  // Only fires on non-null → null transitions to avoid interfering with initial panel open
  // (where selectedId is still null while setSelectedId("legal-check") is queued).
  const prevSelectedIdRef = useRef(selectedId)
  useEffect(() => {
    if (prevSelectedIdRef.current !== null && selectedId === null && quickCheckOpen) {
      setQuickCheckOpen(false)
      setScenarioResult(null)
    }
    prevSelectedIdRef.current = selectedId
  }, [selectedId, quickCheckOpen])

  // Next scheduled duty drives the banner — no more ticking countdown.
  //
  // IMPORTANT: we deliberately do NOT mirror `restUntilLegal`, `futureDuties`,
  // or any other `useFDPData` output into local state. SWR revalidations and
  // airport-timezone resolution hand us new array references repeatedly; any
  // setState-on-prop-change pattern risks React error #185 ("Maximum update
  // depth exceeded") which the chart error boundary surfaces as "Chart failed
  // to render". Static snapshots from the data hook are sufficient.
  const nextDuty = futureDuties[0]
  const nextDestination = extractDestination(nextDuty?.route)
  const restHadMinutes = restUntilLegal?.restElapsedMinutes ?? 0
  const restRequiredMinutes = restUntilLegal?.requiredRestMinutes ?? 0
  const isRestMet = restHadMinutes >= restRequiredMinutes

  // Header actions: refresh + quick check
  const fdpActions = useMemo(
    () => (
      <div className="flex gap-2">
        <GlassIconButton
          ariaLabel="Legality quick check"
          onClick={() => setQuickCheckOpen((prev) => !prev)}
        >
          <Calculator className={cn("h-5 w-5", quickCheckOpen && "text-primary")} />
        </GlassIconButton>
        <GlassIconButton
          ariaLabel="Refresh FDP data"
          onClick={() => refresh()}
          disabled={isLoading}
        >
          <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
        </GlassIconButton>
      </div>
    ),
    [refresh, isLoading, quickCheckOpen]
  )

  useRegisterMainActions(fdpActions, true)

  return (
    <PageContainer>
      <div className="px-4 pt-2 pb-safe space-y-2">
        {/* Next duty banner — reports next scheduled duty + rest vs. requirement.
            Static snapshot from useFDPData; no tick interval to avoid setState
            churn that could crash the chart (React error #185). */}
        {nextDuty ? (
          <Card
            className={cn(
              "border py-0 gap-0",
              isRestMet
                ? "border-status-valid/20 bg-status-valid/5"
                : "border-status-error/20 bg-status-error/5"
            )}
          >
            <CardContent className="py-1.5 px-2.5">
              <div className="flex items-center gap-2.5">
                {/* Left: next reporting time in distinctive serif/mono */}
                <div className="flex flex-col leading-none shrink-0">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    Next
                  </span>
                  <span className="font-serif italic text-base tabular-nums text-foreground mt-0.5">
                    {formatShortDate(nextDuty.date)} {nextDuty.reportTime}Z
                  </span>
                </div>
                {nextDestination && (
                  <div className="border-l border-border pl-2.5 min-w-0 shrink-0">
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground block leading-none">
                      Dest
                    </span>
                    <span className="text-sm font-semibold text-foreground mt-0.5 block leading-none">
                      {nextDestination}
                    </span>
                  </div>
                )}
                {restUntilLegal && (
                  <div className="border-l border-border pl-2.5 min-w-0 flex-1">
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground block leading-none">
                      Rest
                    </span>
                    <span
                      className={cn(
                        "text-sm font-semibold tabular-nums mt-0.5 block leading-none",
                        isRestMet ? "text-status-valid" : "text-status-error"
                      )}
                    >
                      {formatMinutesHM(restHadMinutes)}
                      <span className="text-muted-foreground mx-0.5">/</span>
                      {formatMinutesHM(restRequiredMinutes)}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : restUntilLegal ? (
          /* Fallback: no upcoming scheduled duty but we have rest info */
          <Card className="border border-border/60 py-0 gap-0">
            <CardContent className="py-1.5 px-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex flex-col leading-none shrink-0">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    Next
                  </span>
                  <span className="font-serif italic text-sm text-muted-foreground mt-0.5">
                    None scheduled
                  </span>
                </div>
                <div className="border-l border-border pl-2.5 flex-1">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground block leading-none">
                    Rest since last duty
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-foreground mt-0.5 block leading-none">
                    {formatMinutesHM(restHadMinutes)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Forecast breach — rest violations are now rendered as red overlays
            on the chart itself, so only the breach forecast stays inline here. */}
        {forecast.hasExceedance && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1">
            <div className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-status-critical" />
              <span className="text-[10px] text-status-critical">Breach forecast</span>
            </div>
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
              restViolationDates={restViolations.map((dp) => dp.date)}
              scenarioTimelineData={scenarioResult?.timelineData}
              scenarioModifiedDates={scenarioResult?.modifiedDates}
              scenarioRemovedDates={scenarioResult?.removedDates}
              onClearScenario={() => setScenarioResult(null)}
            />
          </ChartErrorBoundary>
        ) : !isLoading ? (
          <EmptyState
            icon={TrendingUp}
            title="No Duty Periods"
            description="Import schedule or log flights to see FDP compliance."
          />
        ) : null}
      </div>
    </PageContainer>
  )
}
