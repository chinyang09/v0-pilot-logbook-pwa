"use client"

import { Component, useMemo, useState, useEffect, useCallback, useRef, type ReactNode, type ErrorInfo } from "react"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import {
  TrendingUp,
  AlertTriangle,
  Calculator,
} from "lucide-react"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { usePreferences } from "@/components/providers/preferences-provider"
import {
  FTL_PRESETS,
  type RegulationType,
} from "@/types/entities/roster.types"
import { DutyTimeline, type TimelineScenario } from "@/components/roster/duty-timeline"
import { buildDutyTimeline } from "@/lib/utils/roster/duty-timeline"
import { useFlights } from "@/hooks/data/use-flights"
import { useScheduleEntries } from "@/hooks/data/use-schedule"
import { QuickCheckPanel } from "@/components/roster/quick-check-panel"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useMainPanelFullWidth } from "@/lib/layout/panel-mode"
import type { ScenarioResult } from "@/lib/utils/roster/fdp-calculator"
import { cn } from "@/lib/utils"

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
        <Card className="py-0 gap-0">
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

export default function FDPPage() {
  const {
    allDutyPeriods,
    forecast,
    isLoading,
  } = useFDPData()
  // The duty timeline draws each duty's sectors, so it needs the rows they
  // name, and the roster for the ground duties the pipeline does not count.
  const { flights } = useFlights()
  const { scheduleEntries } = useScheduleEntries()
  const flightsById = useMemo(() => new Map(flights.map((f) => [f.id, f])), [flights])
  const dutyBlocks = useMemo(
    () => buildDutyTimeline(allDutyPeriods, flightsById, scheduleEntries),
    [allDutyPeriods, flightsById, scheduleEntries],
  )

  const { preferences } = usePreferences()
  const activeRule: RegulationType = preferences.dutyTimeDefaults?.regulationType ?? "CAAS"

  const { selectedId, setDetailContent, setSelectedId } = useDetailPanel()
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [quickCheckOpen, setQuickCheckOpen] = useState(false)
  // The Quick Check's what-if on the duty timeline: the roster as the
  // scenario leaves it, rest recomputed, and the duties it took out.
  const timelineScenario = useMemo<TimelineScenario | null>(() => {
    if (!scenarioResult) return null
    return {
      blocks: buildDutyTimeline(scenarioResult.dutyPeriods, flightsById, scheduleEntries),
      removed: dutyBlocks.filter((b) => scenarioResult.removedIds.has(b.id)),
      problems: scenarioResult.violations.length,
    }
  }, [scenarioResult, flightsById, scheduleEntries, dutyBlocks])

  // Stable refs for detail panel setters — these change identity on every URL
  // update (setSelectedId is a useCallback with searchParams in deps, so
  // router.replace → searchParams → new setSelectedId ref). Including them
  // in effect deps causes an infinite setState loop ("Maximum update depth
  // exceeded") because the effect calls setSelectedId → URL changes →
  // setSelectedId new ref → effect reruns.
  const setDetailContentRef = useRef(setDetailContent)
  const setSelectedIdRef = useRef(setSelectedId)
  useEffect(() => { setDetailContentRef.current = setDetailContent })
  useEffect(() => { setSelectedIdRef.current = setSelectedId })

  const activeLimits = useMemo(
    () => FTL_PRESETS[activeRule] ?? FTL_PRESETS.CAAS,
    [activeRule]
  )

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
  }, [quickCheckOpen, allDutyPeriods, activeLimits])

  // Sync quickCheckOpen when selectedId is cleared externally (e.g., mobile back button).
  // Only fires on non-null → null transitions to avoid interfering with initial panel open
  // (where selectedId is still null while setSelectedId("legal-check") is queued).
  // The what-if it checked STAYS on both charts until it is cleared there: on a
  // phone the check covers the charts, so going back to them is how it is read.
  const prevSelectedIdRef = useRef(selectedId)
  useEffect(() => {
    if (prevSelectedIdRef.current !== null && selectedId === null && quickCheckOpen) {
      setQuickCheckOpen(false)
    }
    prevSelectedIdRef.current = selectedId
  }, [selectedId, quickCheckOpen])

  // The chart IS the page, so on a tablet it takes the main AND detail
  // panels' width — there is nothing behind it to open beside it. A tapped
  // day used to open in the detail panel, which on a phone covered the chart
  // on every tap of a gesture meant to scrub it, to say what the tooltip and
  // the chart's own series already say. The Quick Check is the one thing
  // that needs the panel, and opening it gives the panel back.
  useMainPanelFullWidth(!quickCheckOpen)

  // Header actions: the Quick Check, a TOOL — one capsule (see the header
  // rule in glass-icon-button.tsx). There is no Refresh: it re-read the
  // schedule table, which every write and every sync already does.
  const fdpActions = useMemo(
    () => (
      <GlassIconButton
        ariaLabel="Legality quick check"
        onClick={() => setQuickCheckOpen((prev) => !prev)}
      >
        <Calculator className={cn("h-5 w-5", quickCheckOpen && "text-primary")} />
      </GlassIconButton>
    ),
    [quickCheckOpen]
  )

  useRegisterMainActions(fdpActions, true)

  return (
    <PageContainer title="FDP">
      <div className="px-panel pt-2 space-y-2">
        {/* The rolling limits and the duties that make them, on one time
            axis, read at one pointer. */}
        {dutyBlocks.length > 0 ? (
          <ChartErrorBoundary>
            <DutyTimeline
              blocks={dutyBlocks}
              limits={activeLimits}
              forecast={forecast}
              scenario={timelineScenario}
              onClearScenario={() => setScenarioResult(null)}
            />
          </ChartErrorBoundary>
        ) : !isLoading ? (
          <EmptyState
            icon={TrendingUp}
            title="No Duty Periods Yet"
            description="Log or import flights to see FDP."
          />
        ) : null}
      </div>
    </PageContainer>
  )
}
