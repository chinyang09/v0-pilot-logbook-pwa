"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Cell,
  Area,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { ZoomIn, ZoomOut, RotateCcw, X } from "lucide-react"
import { useDeferredAnimation } from "@/hooks/use-deferred-animation"

// Custom inline icons for the multi/single toggle — tailored shapes that
// visually communicate "stacked rolling areas" vs "single rolling area".
const MultiSelectIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="m2.75 19.25l5.325-5.325q.575-.575 1.425-.575t1.425.575L13.5 16.5l6.4-7.225q.275-.325.713-.325t.737.3q.275.275.287.663t-.262.687L14.9 17.9q-.575.65-1.425.688T12 18l-2.5-2.5l-5.25 5.25q-.325.325-.75.325t-.75-.325t-.325-.75t.325-.75m0-6l5.325-5.325Q8.65 7.35 9.5 7.35t1.425.575L13.5 10.5l6.4-7.225q.275-.325.713-.325t.737.3q.275.275.287.662t-.262.688L14.9 11.9q-.575.65-1.425.688T12 12L9.5 9.5l-5.25 5.25q-.325.325-.75.325t-.75-.325t-.325-.75t.325-.75"/>
  </svg>
)
const SingleSelectIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M2.75 17.75q-.325-.325-.325-.75t.325-.75l5.325-5.325q.575-.575 1.425-.575t1.425.575L13.5 13.5l6.4-7.225q.275-.325.713-.325t.737.3q.275.275.287.662t-.262.688L14.9 14.9q-.575.65-1.425.688T12 15l-2.5-2.5l-5.25 5.25q-.325.325-.75.325t-.75-.325"/>
  </svg>
)
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import type { TimelineDataPoint } from "@/lib/utils/roster/fdp-calculator"
import type { FTLLimits, CapacityRemaining, ForecastResult } from "@/types/entities/roster.types"

type ChartView = "duty14" | "duty28" | "flight28" | "flight365"

interface ViewConfig {
  key: ChartView
  label: string
  rollingKey: keyof TimelineDataPoint
  limitValue: number
  barKey: keyof TimelineDataPoint
  barLabel: string
  rollingLabel: string
  unit: string
  color: string
}

// SVG-safe hex palette — muted / desaturated for night-time viewing comfort.
// Orange (#d68a3e) is reserved for scenario "what-if" change highlighting, so
// flight365 uses a slate-cyan that does not conflict with orange.
const VIEW_COLORS: Record<string, string> = {
  duty14: "#6b8eae",   // muted steel blue
  duty28: "#8a7aa5",   // muted purple
  flight28: "#5a9478", // muted sage green
  flight365: "#6fa3b0",// muted slate-cyan (distinct from orange)
}

// Semantic colors for data bars and compliance indicators (hex for SVG compatibility)
const COLORS = {
  dutyBar: "#6b8eae",     // muted blue for duty hours bars
  flightBar: "#8a7e4a",   // muted warm khaki for flight hours bars
  restBar: "#4a8870",     // muted green for rest hours bars
  violation: "#b04e3a",   // muted red
  warning90: "#b08040",   // muted amber for 90% line
  scenario: "#d68a3e",    // muted orange — scenario/what-if change highlight
}

interface FDPTimelineChartProps {
  timelineData: TimelineDataPoint[]
  limits: FTLLimits
  capacity: CapacityRemaining
  forecast: ForecastResult
  /** Dates (YYYY-MM-DD) where the rest-before-duty was non-compliant. Rendered
   *  as a red column overlay on the chart, replacing the old inline alert. */
  restViolationDates?: string[]
  /** Scenario overlay: if set, renders scenario timeline with highlights */
  scenarioTimelineData?: TimelineDataPoint[]
  scenarioModifiedDates?: Set<string>
  scenarioRemovedDates?: Set<string>
  /** Called when the user taps the on-chart reset button to clear the
   *  scenario overlay. When omitted, the reset button is hidden. */
  onClearScenario?: () => void
}

export function FDPTimelineChart({
  timelineData,
  limits,
  capacity,
  forecast,
  restViolationDates,
  scenarioTimelineData,
  scenarioModifiedDates,
  scenarioRemovedDates,
  onClearScenario,
}: FDPTimelineChartProps) {
  // Stage-by-stage diagnostics for chart render pipeline. These logs are
  // intentionally verbose so that a chart-failed-to-render report can be
  // traced to the exact stage (props → mount → probe → sanitize → slice → mount).
  console.log("[FDP-chart] ▶ render", {
    timelineDataLen: timelineData?.length ?? 0,
    hasCapacity: !!capacity,
    hasForecast: !!forecast,
    hasScenario: !!scenarioTimelineData,
    scenarioLen: scenarioTimelineData?.length ?? 0,
    limits: limits?.regulationType,
  })

  // Skip the chart's entrance animation on navigation (it competes with the nav
  // transition and hitches it); animate later in-page filter changes.
  const animateCharts = useDeferredAnimation()

  const [activeViews, setActiveViews] = useState<Set<ChartView>>(new Set(["duty14"]))

  // Gesture zoom/pan state — visible window into the data array
  const MIN_WINDOW = 7 // minimum 7 days visible
  const DEFAULT_WINDOW = 28 // default to 28 days
  const [viewWindow, setViewWindow] = useState<{ start: number; end: number } | null>(null)
  const gestureRef = useRef<{
    mode: "pan" | "pinch" | "edge-left" | "edge-right"
    startX: number
    startWindow: { start: number; end: number }
    pinchStartDist: number
    pinchStartWindow: { start: number; end: number }
    wrapperWidth: number
  } | null>(null)
  const overviewRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const CHART_LEFT_PX = 0 // YAxis is hidden — no left gutter needed
  const CHART_RIGHT_PX = 4 // right margin — same for main + overview, kept tight so zoom tools sit ~1px from plot
  const CHART_EDGE_PAD = 18 // horizontal padding so first/last X-axis tick labels aren't clipped
  const EDGE_TOLERANCE = 24 // px tolerance for edge-drag detection
  // Overview gesture dismiss timer (kept for tooltip dismiss on gesture end)
  const overviewDateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hide tooltip after touch ends (Recharts doesn't auto-dismiss on mobile)
  const [tooltipActive, setTooltipActive] = useState(true)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Defer Recharts mount by one frame. On hard refresh, the ResponsiveContainer
  // can briefly compute a 0×0 viewport (before layout settles), producing NaN
  // coordinates that crash SVG rendering. Waiting for rAF after mount ensures
  // the parent has measurable dimensions before Recharts initializes.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    console.log("[FDP-chart] ① mount effect scheduled")
    const raf = requestAnimationFrame(() => {
      console.log("[FDP-chart] ② rAF fired → mounted=true")
      setMounted(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  // Resolve oklch CSS variables to rgb for SVG attributes (SVG fill/stroke
  // cannot use hsl(var(...)) when the variable holds an oklch value).
  // A hidden probe div carries the Tailwind classes; getComputedStyle returns rgb.
  // Uses inline visibility:hidden instead of sr-only (clip-path:inset breaks iOS Safari).
  const probeRef = useRef<HTMLDivElement>(null)
  const [cc, setCc] = useState({ text: "#999", border: "#444", card: "#1a1a1a", fg: "#ccc" })
  useEffect(() => {
    // Validate that a computed-style string is a valid SVG color (rgb/rgba/hex/named).
    // An empty string or a stray oklch() would crash Recharts SVG rendering.
    const isValidSvgColor = (v: string | null | undefined): boolean => {
      if (!v) return false
      const s = v.trim()
      if (!s) return false
      // Reject oklch/oklab/lch/lab — SVG can't parse these in attributes.
      if (/^okl|^lab|^lch/i.test(s)) return false
      return true
    }
    const update = () => {
      try {
        const el = probeRef.current
        if (!el) {
          console.warn("[FDP-chart] ③ probe: element not mounted yet")
          return
        }
        const s = getComputedStyle(el)
        const raw = {
          color: s.color, borderColor: s.borderColor,
          backgroundColor: s.backgroundColor, outlineColor: s.outlineColor,
        }
        const next = {
          text: isValidSvgColor(s.color) ? s.color : "#999",
          border: isValidSvgColor(s.borderColor) ? s.borderColor : "#444",
          card: isValidSvgColor(s.backgroundColor) ? s.backgroundColor : "#1a1a1a",
          fg: isValidSvgColor(s.outlineColor) ? s.outlineColor : "#ccc",
        }
        console.log("[FDP-chart] ③ probe resolved", { raw, resolved: next })
        setCc(next)
      } catch (err) {
        // Keep fallback values on any error (e.g., detached node during unmount)
        console.error("[FDP-chart] ③ probe error", err)
      }
    }
    // Initial resolve + re-resolve on light/dark toggle.
    // Defer to next frame so the probe div has been laid out on mount.
    const raf = requestAnimationFrame(update)
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
    }
  }, [])

  const views: ViewConfig[] = useMemo(
    () => [
      {
        key: "duty14" as ChartView,
        label: "14D Duty",
        rollingKey: "rolling14DayDuty" as keyof TimelineDataPoint,
        limitValue: limits.maxDuty14Days,
        barKey: "dutyHours" as keyof TimelineDataPoint,
        barLabel: "Duty",
        rollingLabel: "14D",
        unit: "h",
        color: VIEW_COLORS.duty14,
      },
      {
        key: "duty28" as ChartView,
        label: "28D Duty",
        rollingKey: "rolling28DayDuty" as keyof TimelineDataPoint,
        limitValue: limits.maxDuty28Days,
        barKey: "dutyHours" as keyof TimelineDataPoint,
        barLabel: "Duty",
        rollingLabel: "28D",
        unit: "h",
        color: VIEW_COLORS.duty28,
      },
      {
        key: "flight28" as ChartView,
        label: "28D Flight",
        rollingKey: "rolling28DayFlight" as keyof TimelineDataPoint,
        limitValue: limits.maxFlight28Days,
        barKey: "flightHours" as keyof TimelineDataPoint,
        barLabel: "Flight",
        rollingLabel: "28D",
        unit: "h",
        color: VIEW_COLORS.flight28,
      },
      {
        key: "flight365" as ChartView,
        label: "12M Flight",
        rollingKey: "rolling365DayFlight" as keyof TimelineDataPoint,
        limitValue: limits.maxFlight365Days,
        barKey: "flightHours" as keyof TimelineDataPoint,
        barLabel: "Flight",
        rollingLabel: "12M",
        unit: "h",
        color: VIEW_COLORS.flight365,
      },
    ],
    [limits]
  )

  const selectedNonRestViews = useMemo(
    () => views.filter((v) => activeViews.has(v.key)),
    [activeViews, views]
  )
  const isSingleView = selectedNonRestViews.length === 1
  const primaryView = selectedNonRestViews[0]

  // Multi-select mode toggle — false = single-select (default), true = multi-select
  const [multiSelectMode, setMultiSelectMode] = useState(false)

  // Toggle handler — respects multiSelectMode
  const toggleView = useCallback((key: ChartView) => {
    setActiveViews((prev) => {
      if (!multiSelectMode) {
        // Single-select: tapping a tab selects it exclusively
        return new Set([key])
      }

      // Multi-select: toggle the tab, but never allow zero selections
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size <= 1) return prev
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [multiSelectMode])

  // Mode toggle — when flipping to multi, default to 28-day duty + flight
  // (the most common "am I safe this month" pair). When flipping back to
  // single, collapse to the primary (first) selected view.
  const toggleMultiSelectMode = useCallback(() => {
    setMultiSelectMode((prev) => {
      const next = !prev
      if (next) {
        setActiveViews(new Set<ChartView>(["duty28", "flight28"]))
      } else {
        setActiveViews((av) => {
          const first = av.values().next().value as ChartView | undefined
          return new Set<ChartView>([first ?? "duty14"])
        })
      }
      return next
    })
  }, [])

  // Today marker
  const todayStr = new Date().toISOString().split("T")[0]

  // Format decimal hours to zero-padded "HH:MM" — precise, compact display.
  // Examples: 5.5 → "05:30", 0.25 → "00:15", 14 → "14:00"
  const formatHoursHM = useCallback((hours: number | null | undefined): string => {
    if (hours == null || !Number.isFinite(hours)) return "—"
    const totalMinutes = Math.max(0, Math.round(hours * 60))
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
  }, [])

  // Compact integer formatter — 1000 → "1k", 1500 → "1.5k" (for tight tab displays).
  const formatCap = useCallback((n: number): string => {
    if (!Number.isFinite(n)) return "0"
    const abs = Math.abs(n)
    if (abs >= 1000) {
      const v = n / 1000
      return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`
    }
    return `${Math.round(n)}`
  }, [])

  // Compact denominator formatter for tooltip — drop ":00" trailing zeros and
  // suppress the "h" suffix on >=1000 values (e.g. "/90" not "/90:00", "/1k" not "/1kh").
  const formatLimitShort = useCallback((hours: number): string => {
    if (!Number.isFinite(hours)) return "—"
    if (Math.abs(hours) >= 1000) {
      const v = hours / 1000
      return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`
    }
    const totalMinutes = Math.max(0, Math.round(hours * 60))
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    if (m === 0) return `${h}`
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
  }, [])

  // Custom tooltip
  const CustomTooltip = useCallback(
    ({ active, payload }: { active?: boolean; payload?: Array<{ payload: TimelineDataPoint }> }) => {
      if (!active || !payload || payload.length === 0) return null
      const data = payload[0].payload

      // Header utilization % — uses the primary (first) selected view so the
      // header shows the most relevant rolling figure at a glance.
      const headerView = selectedNonRestViews[0]
      const headerPct = headerView && headerView.limitValue > 0
        ? Math.round(((data[headerView.rollingKey] as number) / headerView.limitValue) * 100)
        : null
      const headerPctColor = headerPct == null ? "text-muted-foreground"
        : headerPct >= 100 ? "text-red-500"
          : headerPct >= 90 ? "text-orange-500"
            : headerPct >= 75 ? "text-yellow-500" : "text-green-500"

      return (
        <div className="backdrop-blur-xl bg-popover/40 border border-border/40 rounded-lg p-2.5 shadow-lg text-xs max-w-[240px]">
          {/* 1. Date + utilization % */}
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <p className="font-medium text-foreground">{data.dateLabel}</p>
            {headerPct != null && (
              <span className={cn("text-[10px] font-medium tabular-nums", headerPctColor)}>
                {headerPct}% utilized
              </span>
            )}
          </div>
          {/* 2. Rolling values for each selected view (14d / 28d / 12M) */}
          <div className="space-y-0.5">
            {selectedNonRestViews.map((view) => {
              const rollingValue = data[view.rollingKey] as number
              return (
                <div key={view.key} className="flex justify-between gap-3">
                  <span style={{ color: view.color }} className="font-medium">{view.rollingLabel}</span>
                  <span className="font-medium tabular-nums">
                    {formatHoursHM(rollingValue)}<span className="text-muted-foreground">/{formatLimitShort(view.limitValue)}</span>
                  </span>
                </div>
              )
            })}
          </div>
          {/* 3. Daily duty + flight */}
          {(data.dutyHours > 0 || data.flightHours > 0) && (
            <div className="space-y-0.5 mt-1.5 pt-1.5 border-t border-border/60">
              {data.dutyHours > 0 && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Duty</span>
                  <span className={cn("font-medium tabular-nums", data.maxFdpHours && data.dutyHours > data.maxFdpHours && "text-red-500")}>
                    {formatHoursHM(data.dutyHours)}{data.maxFdpHours ? `/${formatHoursHM(data.maxFdpHours)}` : ""}
                  </span>
                </div>
              )}
              {data.flightHours > 0 && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Flight</span>
                  <span className="font-medium tabular-nums">{formatHoursHM(data.flightHours)}</span>
                </div>
              )}
            </div>
          )}
          {/* 4. Destination/route */}
          {data.route && (
            <div className="mt-1.5 pt-1.5 border-t border-border/60 text-muted-foreground truncate">
              {data.route}
            </div>
          )}
        </div>
      )
    },
    [selectedNonRestViews, formatHoursHM, formatLimitShort]
  )

  // Sanitize numeric fields to protect Recharts from NaN/Infinity which would
  // crash SVG rendering (NaN coordinates → invalid path → "Chart failed to render").
  const safeTimelineData = useMemo(() => {
    const clean = (v: unknown): number => {
      const n = typeof v === "number" ? v : Number(v)
      return Number.isFinite(n) ? n : 0
    }
    let badCount = 0
    const result = timelineData.map((d) => {
      const o = {
        ...d,
        dutyHours: clean(d.dutyHours),
        flightHours: clean(d.flightHours),
        rolling14DayDuty: clean(d.rolling14DayDuty),
        rolling28DayDuty: clean(d.rolling28DayDuty),
        rolling28DayFlight: clean(d.rolling28DayFlight),
        rolling365DayFlight: clean(d.rolling365DayFlight),
        restHours: d.restHours == null ? null : (Number.isFinite(d.restHours) ? d.restHours : null),
        restRequired: d.restRequired == null ? null : (Number.isFinite(d.restRequired) ? d.restRequired : null),
        maxFdpHours: d.maxFdpHours == null ? null : (Number.isFinite(d.maxFdpHours) ? d.maxFdpHours : null),
      }
      // Count any upstream value that came in non-finite so we can attribute
      // blame when something goes wrong.
      const fields = [d.dutyHours, d.flightHours, d.rolling14DayDuty, d.rolling28DayDuty, d.rolling28DayFlight, d.rolling365DayFlight]
      if (fields.some((v) => typeof v === "number" && !Number.isFinite(v))) badCount++
      return o
    })
    console.log("[FDP-chart] ④ safeTimelineData", { in: timelineData.length, out: result.length, sanitized: badCount })
    return result
  }, [timelineData])

  const safeScenarioData = useMemo(() => {
    if (!scenarioTimelineData) return undefined
    const clean = (v: unknown): number => {
      const n = typeof v === "number" ? v : Number(v)
      return Number.isFinite(n) ? n : 0
    }
    return scenarioTimelineData.map((d) => ({
      ...d,
      dutyHours: clean(d.dutyHours),
      flightHours: clean(d.flightHours),
      rolling14DayDuty: clean(d.rolling14DayDuty),
      rolling28DayDuty: clean(d.rolling28DayDuty),
      rolling28DayFlight: clean(d.rolling28DayFlight),
      rolling365DayFlight: clean(d.rolling365DayFlight),
    }))
  }, [scenarioTimelineData])

  // Unique bar keys across selected views
  const uniqueBarKeys = useMemo(() => {
    const keys = new Set(selectedNonRestViews.map((v) => v.barKey))
    return Array.from(keys) as (keyof TimelineDataPoint)[]
  }, [selectedNonRestViews])

  // Y-axis domain for multi-select — tight 5% headroom above the hard limit
  // (limits are the compliance ceiling; we don't need more than a sliver above).
  const yDomain = useMemo(() => {
    if (selectedNonRestViews.length === 0) return undefined
    const maxLimit = Math.max(...selectedNonRestViews.map((v) => v.limitValue))
    return [0, Math.ceil(maxLimit * 1.05)]
  }, [selectedNonRestViews])

  // Compute the sliced data for the visible window
  const hasScenario = !!safeScenarioData
  const effectiveTimelineData = hasScenario ? safeScenarioData! : safeTimelineData
  const activeData = effectiveTimelineData

  // Reset zoom window when underlying data changes (e.g., refresh/resync)
  // to prevent stale indices from pointing beyond the new data length.
  const prevDataLenRef = useRef(activeData.length)
  useEffect(() => {
    if (prevDataLenRef.current !== activeData.length && viewWindow) {
      setViewWindow(null)
    }
    prevDataLenRef.current = activeData.length
  }, [activeData.length, viewWindow])

  // Smart default window: if the schedule extends into the future, show the
  // last 28 days (working backward from latest). Otherwise (no schedule),
  // anchor around today with 3 weeks historic + 1 week look-ahead.
  const defaultWindowRange = useMemo(() => {
    if (!activeData.length) return { start: 0, end: 0 }
    const lastIdx = activeData.length - 1
    const todayIdx = activeData.findIndex((d) => d.date === todayStr)
    const hasFutureSchedule = todayIdx >= 0 && todayIdx < lastIdx
    if (hasFutureSchedule) {
      return { start: Math.max(0, lastIdx - (DEFAULT_WINDOW - 1)), end: lastIdx }
    }
    const anchor = todayIdx >= 0 ? todayIdx : lastIdx
    const start = Math.max(0, anchor - 20) // 3 weeks back
    const end = Math.min(lastIdx, anchor + 7) // 1 week ahead (clamped)
    return { start, end }
  }, [activeData, todayStr])

  const slicedData = useMemo(() => {
    if (!activeData.length) {
      console.log("[FDP-chart] ⑤ slicedData: empty input → returning []")
      return activeData
    }
    const base = !viewWindow
      ? activeData.slice(defaultWindowRange.start, defaultWindowRange.end + 1)
      : activeData.slice(viewWindow.start, viewWindow.end + 1)

    console.log("[FDP-chart] ⑤ slicedData computed", {
      active: activeData.length,
      viewWindow,
      sliced: base.length,
      firstDate: base[0]?.date,
      lastDate: base[base.length - 1]?.date,
      hasScenario,
    })

    // When a scenario is active, enrich each point with a per-view "scenario
    // change" field that carries the rolling value only for dates that are
    // modified/removed (plus one-day padding on each side so the overlaid area
    // has width and joins the base area smoothly at the boundaries).
    if (!hasScenario) return base
    const changedDates = new Set<string>([
      ...(scenarioModifiedDates ?? []),
      ...(scenarioRemovedDates ?? []),
    ])
    if (changedDates.size === 0) return base
    // Expand: mark a point as "in-change-region" if the point itself OR either
    // neighbor is in changedDates. This guarantees the overlay segment spans
    // at least one full day of chart width and seams with the base area.
    const inRegion = base.map((d, i) => {
      if (changedDates.has(d.date)) return true
      const prev = base[i - 1]
      const next = base[i + 1]
      return (prev && changedDates.has(prev.date)) || (next && changedDates.has(next.date))
    })
    return base.map((d, i) => {
      const out: Record<string, unknown> = { ...d }
      if (inRegion[i]) {
        for (const v of selectedNonRestViews) {
          out[`${v.rollingKey}__change`] = d[v.rollingKey]
        }
      } else {
        for (const v of selectedNonRestViews) {
          out[`${v.rollingKey}__change`] = null
        }
      }
      return out as typeof d
    })
  }, [activeData, viewWindow, hasScenario, scenarioModifiedDates, scenarioRemovedDates, selectedNonRestViews, defaultWindowRange])

  // Effective window for gesture calculations — mirrors slicedData's default.
  const effectiveWindow = useMemo(() => {
    if (!activeData.length) return { start: 0, end: 0 }
    if (!viewWindow) return defaultWindowRange
    return viewWindow
  }, [activeData.length, viewWindow, defaultWindowRange])

  // Gesture handlers for zoom/pan
  const chartWrapperRef = useRef<HTMLDivElement>(null)

  const clampWindow = useCallback((start: number, end: number, maxLen: number) => {
    let s = Math.round(start)
    let e = Math.round(end)
    const minW = MIN_WINDOW
    if (e - s < minW) {
      const mid = (s + e) / 2
      s = Math.round(mid - minW / 2)
      e = s + minW
    }
    if (s < 0) { e -= s; s = 0 }
    if (e >= maxLen) { s -= (e - maxLen + 1); e = maxLen - 1 }
    if (s < 0) s = 0
    return { start: s, end: e }
  }, [])

  // Convert overview touch X position to data index
  const touchToDataIndex = useCallback((clientX: number) => {
    const el = overviewRef.current
    if (!el || activeData.length <= 1) return 0
    const rect = el.getBoundingClientRect()
    const plotWidth = rect.width - CHART_LEFT_PX - CHART_RIGHT_PX
    const relX = clientX - rect.left - CHART_LEFT_PX
    const pct = Math.max(0, Math.min(1, relX / plotWidth))
    return Math.round(pct * (activeData.length - 1))
  }, [activeData.length])

  // Shared move handler — RAF-throttled for smooth real-time updates
  const applyGestureMove = useCallback((touches: React.TouchList) => {
    if (!gestureRef.current) return
    const maxLen = activeData.length
    if (maxLen === 0) return
    const ww = gestureRef.current.wrapperWidth || 300
    const mode = gestureRef.current.mode

    if (mode === "pan" && touches.length >= 1) {
      const dx = touches[0].clientX - gestureRef.current.startX
      // Pan originates from the overview bar: the overview's plot area
      // (ww minus axis gutters) spans the full data range, so one overview
      // pixel maps to activeData.length / plotWidth data indices. This keeps
      // the window moving 1:1 with the finger across the overview.
      const plotWidth = Math.max(1, ww - CHART_LEFT_PX - CHART_RIGHT_PX)
      const dataPxRatio = maxLen / plotWidth
      // Drag right → window moves right (indices increase)
      const shift = Math.round(dx * dataPxRatio)
      setViewWindow(clampWindow(
        gestureRef.current.startWindow.start + shift,
        gestureRef.current.startWindow.end + shift,
        maxLen,
      ))
    } else if (mode === "pinch" && touches.length === 2) {
      const dist = Math.abs(touches[0].clientX - touches[1].clientX)
      const scale = gestureRef.current.pinchStartDist / Math.max(dist, 1)
      const prevW = gestureRef.current.pinchStartWindow
      const oldSize = prevW.end - prevW.start
      const newSize = Math.round(oldSize * scale)
      const mid = (prevW.start + prevW.end) / 2
      setViewWindow(clampWindow(mid - newSize / 2, mid + newSize / 2, maxLen))
    } else if (mode === "edge-left" && touches.length >= 1) {
      const idx = touchToDataIndex(touches[0].clientX)
      const end = gestureRef.current.startWindow.end
      const newStart = Math.max(0, Math.min(idx, end - MIN_WINDOW))
      setViewWindow({ start: newStart, end })
    } else if (mode === "edge-right" && touches.length >= 1) {
      const idx = touchToDataIndex(touches[0].clientX)
      const start = gestureRef.current.startWindow.start
      const newEnd = Math.min(maxLen - 1, Math.max(idx, start + MIN_WINDOW))
      setViewWindow({ start, end: newEnd })
    }
  }, [activeData.length, clampWindow, touchToDataIndex])

  const handleGestureMove = useCallback((e: React.TouchEvent) => {
    if (!gestureRef.current) return
    e.preventDefault()
    cancelAnimationFrame(rafRef.current)
    // Copy touch data before RAF (React pools events)
    const touchData = Array.from(e.touches).map((t) => ({ clientX: t.clientX }))
    rafRef.current = requestAnimationFrame(() => {
      applyGestureMove({ length: touchData.length, 0: touchData[0], 1: touchData[1] } as unknown as React.TouchList)
    })
  }, [applyGestureMove])

  const handleGestureEnd = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    gestureRef.current = null
    if (overviewDateTimerRef.current) clearTimeout(overviewDateTimerRef.current)
    // Dismiss tooltip after 2s
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    tooltipTimerRef.current = setTimeout(() => setTooltipActive(false), 2000)
  }, [])

  // Main chart touch — pinch zoom only, single finger = tooltip (passthrough)
  const handleChartTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch zoom — dismiss tooltip immediately
      setTooltipActive(false)
      const dist = Math.abs(e.touches[0].clientX - e.touches[1].clientX)
      const wrapper = chartWrapperRef.current
      gestureRef.current = {
        mode: "pinch",
        startX: 0,
        startWindow: { ...effectiveWindow },
        pinchStartDist: dist,
        pinchStartWindow: { ...effectiveWindow },
        wrapperWidth: wrapper?.clientWidth || 300,
      }
      return
    }
    if (e.touches.length === 1) {
      // Chart body — show tooltip, set timer to dismiss
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
      setTooltipActive(true)
    }
  }, [effectiveWindow])

  // Overview touch — detect edge-drag, window-drag, or jump
  const handleOverviewTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 1) return
    if (overviewDateTimerRef.current) clearTimeout(overviewDateTimerRef.current)
    // Dismiss chart tooltip/focus when interacting with overview
    setTooltipActive(false)

    const wrapper = overviewRef.current
    if (!wrapper) return
    const rect = wrapper.getBoundingClientRect()
    const touchX = e.touches[0].clientX
    const plotWidth = rect.width - CHART_LEFT_PX - CHART_RIGHT_PX
    const total = Math.max(activeData.length - 1, 1)
    const winLeftPx = rect.left + CHART_LEFT_PX + (effectiveWindow.start / total) * plotWidth
    const winRightPx = rect.left + CHART_LEFT_PX + (effectiveWindow.end / total) * plotWidth
    const ww = wrapper.clientWidth || 300

    if (Math.abs(touchX - winLeftPx) < EDGE_TOLERANCE) {
      // Dragging left edge
      gestureRef.current = {
        mode: "edge-left", startX: touchX, startWindow: { ...effectiveWindow },
        pinchStartDist: 0, pinchStartWindow: { ...effectiveWindow }, wrapperWidth: ww,
      }
    } else if (Math.abs(touchX - winRightPx) < EDGE_TOLERANCE) {
      // Dragging right edge
      gestureRef.current = {
        mode: "edge-right", startX: touchX, startWindow: { ...effectiveWindow },
        pinchStartDist: 0, pinchStartWindow: { ...effectiveWindow }, wrapperWidth: ww,
      }
    } else if (touchX > winLeftPx && touchX < winRightPx) {
      // Inside window → pan
      gestureRef.current = {
        mode: "pan", startX: touchX, startWindow: { ...effectiveWindow },
        pinchStartDist: 0, pinchStartWindow: { ...effectiveWindow }, wrapperWidth: ww,
      }
    } else {
      // Outside window → jump center to touch, then pan
      const idx = touchToDataIndex(touchX)
      const halfWin = Math.round((effectiveWindow.end - effectiveWindow.start) / 2)
      const newWindow = clampWindow(idx - halfWin, idx + halfWin, activeData.length)
      setViewWindow(newWindow)
      gestureRef.current = {
        mode: "pan", startX: touchX, startWindow: newWindow,
        pinchStartDist: 0, pinchStartWindow: newWindow, wrapperWidth: ww,
      }
    }
  }, [effectiveWindow, activeData.length, touchToDataIndex, clampWindow])

  // Zoom button controls
  const zoomIn = useCallback(() => {
    const maxLen = activeData.length
    if (maxLen === 0) return
    const w = effectiveWindow
    const size = w.end - w.start
    const newSize = Math.max(MIN_WINDOW, Math.round(size * 0.6))
    const mid = (w.start + w.end) / 2
    setViewWindow(clampWindow(mid - newSize / 2, mid + newSize / 2, maxLen))
  }, [activeData.length, effectiveWindow, clampWindow])

  const zoomOut = useCallback(() => {
    const maxLen = activeData.length
    if (maxLen === 0) return
    const w = effectiveWindow
    const size = w.end - w.start
    const newSize = Math.min(maxLen - 1, Math.round(size * 1.6))
    const mid = (w.start + w.end) / 2
    setViewWindow(clampWindow(mid - newSize / 2, mid + newSize / 2, maxLen))
  }, [activeData.length, effectiveWindow, clampWindow])

  const resetZoom = useCallback(() => {
    setViewWindow(null)
  }, [])

  // Overview window highlight — CSS calc values for the active window box
  const overviewHighlight = useMemo(() => {
    const total = Math.max(activeData.length - 1, 1)
    const leftPct = (effectiveWindow.start / total) * 100
    const rightPct = ((total - effectiveWindow.end) / total) * 100
    const widthPct = ((effectiveWindow.end - effectiveWindow.start) / total) * 100
    return { leftPct, rightPct, widthPct }
  }, [activeData.length, effectiveWindow])

  // X-axis ticks — show at most 5 labels: start, 25%, 50%, 75%, end.
  // Breaks the period into quarters so the axis stays scannable.
  const xAxisTicks = useMemo(() => {
    const n = slicedData.length
    if (n === 0) return [] as string[]
    if (n === 1) return [slicedData[0].dateLabel]
    const indices = [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1]
    const labels = indices
      .map((i) => slicedData[i]?.dateLabel)
      .filter((v): v is string => !!v)
    return Array.from(new Set(labels))
  }, [slicedData])

  // Shared axis/grid theme props — using resolved rgb from probe
  const axisTickStyle = { fontSize: 10, fill: cc.text }
  const gridStroke = cc.border

  // Theme-aware overlay for the overview's "darken outside window" effect.
  // Dark theme → semi-transparent black (darkens). Light theme → semi-transparent
  // white (lightens). Avoids using the card's own bg, which produces an opaque
  // identical-tone overlay that hides the chart silhouette entirely.
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"
  const cardOverlay = isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.65)"

  return (
    <div
      className="outline-none [&_*]:outline-none [&_*]:focus:outline-none [&_*]:focus-visible:outline-none"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {/* Hidden probe to resolve oklch CSS vars → rgb for SVG.
          Uses visibility:hidden (not sr-only) because clip-path:inset(50%) in sr-only
          prevents getComputedStyle from resolving oklch on iOS Safari. */}
      <div
        ref={probeRef}
        className="text-muted-foreground border-border bg-card outline-foreground"
        style={{ position: "absolute", visibility: "hidden", pointerEvents: "none" }}
        aria-hidden="true"
      />
      <Card className="shadow-sm py-0 gap-0">
        <CardContent className="pt-1.5 pb-1.5 px-1.5 relative">
          {/* View selector tabs — flat, integrated into card with vertical dividers between */}
          <div className="flex overflow-x-auto scrollbar-none divide-x divide-border/60 border-b border-border">
            {views.map((view) => {
              const cap = view.key === "duty14" ? capacity.duty14Days
                : view.key === "duty28" ? capacity.duty28Days
                  : view.key === "flight28" ? capacity.flight28Days
                    : capacity.flight365Days
              const pct = cap.limit > 0 ? (cap.used / cap.limit) * 100 : 0
              const isActive = activeViews.has(view.key)

              const remainingColor = pct >= 100 ? "text-red-500"
                : pct >= 90 ? "text-orange-500"
                  : pct >= 75 ? "text-yellow-500"
                    : "text-green-500"
              const barColor = pct >= 100 ? "bg-red-500"
                : pct >= 90 ? "bg-orange-500"
                  : pct >= 75 ? "bg-yellow-500"
                    : "bg-green-500"

              return (
                <button
                  key={view.key}
                  onClick={() => toggleView(view.key)}
                  style={isActive ? {
                    // Active = subtle view-colored bottom border only — flat, integrated.
                    borderBottomColor: view.color,
                  } : undefined}
                  className={cn(
                    "flex flex-col items-start px-1.5 py-1 text-left transition-colors min-w-0 flex-1 relative border-b-2 bg-transparent",
                    isActive
                      ? "text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="text-[10px] leading-tight font-medium truncate w-full">{view.label}</span>
                  <span className="text-xs font-bold tabular-nums leading-tight text-foreground">
                    {formatCap(cap.used)}<span className="font-normal text-[10px] text-muted-foreground">/{formatCap(cap.limit)}</span>
                  </span>
                  <div className="flex items-center gap-1 mt-0.5 w-full">
                    <div className="h-1 rounded-full flex-1 bg-muted">
                      <div
                        className={cn("h-full rounded-full transition-all", barColor)}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className={cn("text-[9px] font-semibold whitespace-nowrap", remainingColor)}>
                      {cap.remaining.toFixed(0)}h
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          {!mounted ? (
            <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
              <div className="h-5 w-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            </div>
          ) : safeTimelineData.length === 0 ? (
            <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
              No data to display
            </div>
          ) : (
          <>
            {/* Horizontal zoom controls row — sits between tabs and chart, left-aligned */}
            <div className="flex items-center justify-start gap-0.5 py-1">
              <button
                onClick={toggleMultiSelectMode}
                className={cn(
                  "p-1 rounded transition-colors",
                  multiSelectMode ? "text-primary" : "text-muted-foreground hover:bg-secondary"
                )}
                aria-label={multiSelectMode ? "Switch to single-select" : "Switch to multi-select"}
                title={multiSelectMode ? "Multi-select (tap to switch to single)" : "Single-select (tap to switch to multi)"}
              >
                {multiSelectMode
                  ? <MultiSelectIcon className="h-4 w-4" />
                  : <SingleSelectIcon className="h-4 w-4" />}
              </button>
              <div className="h-3.5 w-px bg-border mx-1" />
              <button
                onClick={zoomIn}
                className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={zoomOut}
                className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              {viewWindow && (
                <button
                  onClick={resetZoom}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors"
                  aria-label="Reset zoom"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              {hasScenario && onClearScenario && (
                <button
                  onClick={onClearScenario}
                  className="p-1 rounded hover:bg-secondary transition-colors"
                  style={{ color: COLORS.scenario }}
                  aria-label="Clear scenario overlay"
                  title="Clear scenario overlay"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          {(() => {
            console.log("[FDP-chart] ⑥ about to render ResponsiveContainer", {
              mounted,
              slicedLen: slicedData.length,
              viewsSelected: Array.from(activeViews),
              cc,
              yDomain,
            })
            return null
          })()}
          {(
            /* Duty/Flight rolling chart — supports multi-select */
            <div
              ref={chartWrapperRef}
              onTouchStart={handleChartTouchStart}
              onTouchMove={handleGestureMove}
              onTouchEnd={handleGestureEnd}
              className="touch-none relative"
            >
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={slicedData} margin={{ top: 14, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    {selectedNonRestViews.map((view) => (
                      <linearGradient key={view.key} id={`gradient-${view.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={view.color} stopOpacity={isSingleView ? 0.5 : 0.35} />
                        <stop offset="95%" stopColor={view.color} stopOpacity={0.08} />
                      </linearGradient>
                    ))}
                    {/* Scenario overlay gradient — muted orange for what-if changes */}
                    <linearGradient id="gradient-scenario-change" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.scenario} stopOpacity={0.55} />
                      <stop offset="95%" stopColor={COLORS.scenario} stopOpacity={0.12} />
                    </linearGradient>
                    {/* Future-region fade — left edge transitions from transparent
                        to the dimmed overlay across the first 10% so the boundary
                        with present-day data feels seamless instead of a hard step. */}
                    <linearGradient id="future-fade" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={isDark ? "#000" : "#fff"} stopOpacity={0} />
                      <stop offset="10%" stopColor={isDark ? "#000" : "#fff"} stopOpacity={isDark ? 0.35 : 0.5} />
                      <stop offset="100%" stopColor={isDark ? "#000" : "#fff"} stopOpacity={isDark ? 0.35 : 0.5} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="dateLabel"
                    tick={axisTickStyle}
                    tickLine={false}
                    axisLine={false}
                    ticks={xAxisTicks}
                    interval={0}
                    padding={{ left: CHART_EDGE_PAD, right: CHART_EDGE_PAD }}
                  />
                  <YAxis hide domain={yDomain} />
                  <Tooltip
                    content={<CustomTooltip />}
                    active={tooltipActive ? undefined : false}
                    position={{ x: 4, y: 0 }}
                    cursor={{ stroke: cc.text, strokeOpacity: 0.3, strokeDasharray: "2 2" }}
                    wrapperStyle={{ pointerEvents: "none", outline: "none" }}
                  />

                  {/* Limit threshold lines — one per selected view */}
                  {selectedNonRestViews.map((view) => (
                    <ReferenceLine
                      key={`limit-${view.key}`}
                      y={view.limitValue}
                      stroke={isSingleView ? COLORS.violation : view.color}
                      strokeDasharray={isSingleView ? "0" : "6 3"}
                      strokeWidth={2}
                      label={{
                        value: `${view.limitValue}h`,
                        position: "insideTopRight",
                        fill: isSingleView ? COLORS.violation : view.color,
                        fontSize: 10,
                      }}
                    />
                  ))}

                  {/* Warning threshold (90%) — only for single view */}
                  {isSingleView && primaryView && (
                    <ReferenceLine
                      y={primaryView.limitValue * 0.9}
                      stroke={COLORS.warning90}
                      strokeDasharray="3 3"
                      strokeWidth={1}
                      opacity={0.5}
                    />
                  )}

                  {/* Today marker — always rendered when today falls inside the
                      visible window. Uses a solid (non-opacity) label color and
                      extra top margin on the chart so the "Today" text isn't
                      clipped by the plot area. Colored to contrast with both
                      the chart palette and the scenario-orange overlay. */}
                  {slicedData.some((d) => d.date === todayStr) && (
                    <ReferenceLine
                      x={slicedData.find((d) => d.date === todayStr)?.dateLabel}
                      stroke={cc.fg}
                      strokeDasharray="3 3"
                      strokeWidth={1.25}
                      label={{
                        value: "Today",
                        position: "top",
                        fill: cc.fg,
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    />
                  )}

                  {/* Future region overlay — progressive fade from today rightward. */}
                  {(() => {
                    const todayIdx = slicedData.findIndex((d) => d.date === todayStr)
                    if (todayIdx >= 0 && todayIdx < slicedData.length - 1) {
                      return (
                        <ReferenceArea
                          x1={slicedData[todayIdx].dateLabel}
                          x2={slicedData[slicedData.length - 1].dateLabel}
                          fill="url(#future-fade)"
                          fillOpacity={1}
                          strokeOpacity={0}
                        />
                      )
                    }
                    return null
                  })()}

                  {/* Rest violation overlays — one red column per violation date.
                      Uses the same translucent-fill pattern as the future region
                      so violations read as "this column is problematic" without
                      a separate alert banner above the chart. */}
                  {restViolationDates?.map((vDate) => {
                    const hit = slicedData.find((d) => d.date === vDate)
                    if (!hit) return null
                    return (
                      <ReferenceArea
                        key={`rest-viol-${vDate}`}
                        x1={hit.dateLabel}
                        x2={hit.dateLabel}
                        fill={COLORS.violation}
                        fillOpacity={0.22}
                        strokeOpacity={0}
                      />
                    )
                  })}

                  {/* Rolling cumulative areas — one per selected view.
                      activeDot is a hollow ring: outer stroke uses the view color,
                      inner fill uses the card background so it reads as a ring
                      instead of a filled dot with a dark border. */}
                  {selectedNonRestViews.map((view) => (
                    <Area
                      key={`area-${view.key}`}
                      dataKey={view.rollingKey}
                      fill={`url(#gradient-${view.key})`}
                      stroke={view.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: cc.card, stroke: view.color, strokeWidth: 2 }}
                      name={view.rollingLabel}
                      isAnimationActive={animateCharts}
                    />
                  ))}

                  {/* Scenario change overlay — orange area painted over the
                      base area for dates that differ from the original timeline.
                      Only rendered when a what-if scenario is active.
                      Animates in sync with the base area so it doesn't pop. */}
                  {hasScenario && selectedNonRestViews.map((view) => (
                    <Area
                      key={`area-change-${view.key}`}
                      dataKey={`${view.rollingKey}__change`}
                      fill="url(#gradient-scenario-change)"
                      stroke={COLORS.scenario}
                      strokeWidth={2}
                      dot={false}
                      activeDot={false}
                      connectNulls={false}
                      name="Scenario change"
                      isAnimationActive={animateCharts}
                    />
                  ))}

                  {/* Daily bars — duty: blue, flight: yellow, red when rolling exceeds limit */}
                  {uniqueBarKeys.map((barKey) => {
                    const barView = selectedNonRestViews.find((v) => v.barKey === barKey)!
                    const barColor = barKey === "dutyHours" ? COLORS.dutyBar : COLORS.flightBar
                    return (
                      <Bar
                        key={`bar-${barKey}`}
                        dataKey={barKey}
                        radius={[2, 2, 0, 0]}
                        maxBarSize={uniqueBarKeys.length > 1 ? 12 : 16}
                        name={barView.barLabel}
                        isAnimationActive={animateCharts}
                      >
                        {slicedData.map((entry, index) => {
                          const isModified = hasScenario && scenarioModifiedDates?.has(entry.date)
                          const isRemoved = hasScenario && scenarioRemovedDates?.has(entry.date)
                          // Red bar when rolling cumulative exceeds the limit for the active view
                          const rollingValue = primaryView ? (entry[primaryView.rollingKey] as number) : 0
                          const exceedsLimit = primaryView ? rollingValue > primaryView.limitValue : false
                          const cellColor = isModified ? COLORS.scenario // orange for scenario additions/changes
                            : isRemoved ? COLORS.violation // red for removed
                              : exceedsLimit ? COLORS.violation // red for limit exceedance
                                : barColor
                          const cellOpacity = isRemoved ? 0.2
                            : isModified ? 0.9
                              : entry.isFuture ? 0.3 : 0.7
                          return (
                            <Cell key={index} fill={cellColor} opacity={cellOpacity} />
                          )
                        })}
                      </Bar>
                    )
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Overview mini-chart — "big picture" with rolling lines + active window.
              Placed inside flex-1 min-w-0 so it aligns width-wise with the main chart
              (excluding the zoom tools column on the right). */}
          {mounted && activeData.length > 0 && (
            <div
              ref={overviewRef}
              onTouchStart={handleOverviewTouchStart}
              onTouchMove={handleGestureMove}
              onTouchEnd={handleGestureEnd}
              className="relative -mt-1 touch-none cursor-grab active:cursor-grabbing select-none"
              style={{ paddingTop: 0, paddingBottom: 0 }}
            >
              {/* Rounded clip container — chart, darken overlays, and window all share
                  these rounded corners so the darkened regions clip seamlessly into them. */}
              <div className="relative overflow-hidden rounded-md" style={{ marginLeft: CHART_LEFT_PX, marginRight: CHART_RIGHT_PX }}>
                <ResponsiveContainer width="100%" height={50}>
                  <ComposedChart data={activeData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                    <defs>
                      {selectedNonRestViews.map((view) => (
                        <linearGradient key={`ov-grad-${view.key}`} id={`ov-gradient-${view.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={view.color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={view.color} stopOpacity={0.02} />
                        </linearGradient>
                      ))}
                    </defs>
                    <XAxis dataKey="dateLabel" hide />
                    <YAxis hide domain={[0, "auto"]} />
                    {selectedNonRestViews.map((view) => (
                      <Area
                        key={`ov-${view.key}`}
                        dataKey={view.rollingKey}
                        fill={`url(#ov-gradient-${view.key})`}
                        stroke={view.color}
                        strokeWidth={1}
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>

                {/* Active window box with rounded corners. The huge box-shadow
                    paints the darkened region *outside* the window and is clipped
                    by the parent `overflow-hidden rounded-md` container — this
                    creates a seamless rounded "cutout" with no visible seams. */}
                <div
                  className="absolute inset-y-0 border border-foreground/40 rounded-md pointer-events-none"
                  style={{
                    left: `${overviewHighlight.leftPct}%`,
                    width: `${overviewHighlight.widthPct}%`,
                    boxShadow: `0 0 0 9999px ${cardOverlay}`,
                  }}
                >
                  {/* Edge grab handles */}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[3px] w-1.5 h-5 rounded-full bg-foreground/40" />
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-[3px] w-1.5 h-5 rounded-full bg-foreground/40" />
                </div>
              </div>

            </div>
          )}
          </>
          )}

          {/* Forecast exceedance warnings — inside card */}
          {forecast.hasExceedance && (
            <div className="px-1 pb-1 space-y-1">
              {forecast.exceedances
                .filter((exc) => {
                  return Array.from(activeViews).some((viewKey) => {
                    if (viewKey === "duty14") return exc.limitName.includes("14-day duty")
                    if (viewKey === "duty28") return exc.limitName.includes("28-day duty")
                    if (viewKey === "flight28") return exc.limitName.includes("28-day flight")
                    if (viewKey === "flight365") return exc.limitName.includes("12-month flight")
                    return false
                  })
                })
                .slice(0, 3)
                .map((exc, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-red-500/10"
                  >
                    <span className="text-red-500 font-medium">
                      {(() => { const d = new Date(exc.date + "T00:00:00Z"); return `${d.getUTCDate().toString().padStart(2, "0")} ${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}`; })()}
                    </span>
                    <span className="text-red-500">
                      {exc.projected.toFixed(1)}h / {exc.limit}h
                    </span>
                  </div>
                ))}
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  )
}
