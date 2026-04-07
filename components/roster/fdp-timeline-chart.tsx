"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Cell,
  Area,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Check, ZoomIn, ZoomOut, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TimelineDataPoint } from "@/lib/utils/roster/fdp-calculator"
import type { FTLLimits, CapacityRemaining, ForecastResult } from "@/types/entities/roster.types"

type ChartView = "duty14" | "duty28" | "flight28" | "flight365" | "rest"

interface ViewConfig {
  key: ChartView
  label: string
  regulation: string
  rollingKey: keyof TimelineDataPoint
  limitValue: number
  barKey: keyof TimelineDataPoint
  barLabel: string
  rollingLabel: string
  unit: string
  color: string
}

// OKLCH palette — perceptually uniform, works on both light and dark backgrounds
const VIEW_COLORS: Record<string, string> = {
  duty14: "oklch(0.65 0.15 250)",   // bright blue
  duty28: "oklch(0.60 0.15 300)",   // purple-violet
  flight28: "oklch(0.65 0.18 155)", // vivid teal-green
  flight365: "oklch(0.70 0.15 55)", // warm amber
}

// Semantic colors for data bars and compliance indicators
const COLORS = {
  dutyBar: "oklch(0.65 0.15 250)",     // blue for duty hours bars
  flightBar: "oklch(0.70 0.15 80)",    // yellow-amber for flight hours bars
  restBar: "oklch(0.65 0.20 155)",     // green for rest hours bars
  violation: "oklch(0.60 0.22 25)",    // warm red
  warning90: "oklch(0.70 0.15 55)",    // amber for 90% line
}

interface FDPTimelineChartProps {
  timelineData: TimelineDataPoint[]
  limits: FTLLimits
  capacity: CapacityRemaining
  forecast: ForecastResult
}

export function FDPTimelineChart({
  timelineData,
  limits,
  capacity,
  forecast,
}: FDPTimelineChartProps) {
  const [activeViews, setActiveViews] = useState<Set<ChartView>>(new Set(["duty14"]))

  // Gesture zoom/pan state — visible window into the data array
  const MIN_WINDOW = 7 // minimum 7 days visible
  const DEFAULT_WINDOW = 90 // default to ~90 days
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
  const CHART_LEFT_PX = 40 // YAxis width
  const CHART_RIGHT_PX = 20 // right margin — same for main + overview
  const EDGE_TOLERANCE = 24 // px tolerance for edge-drag detection
  // Fade-in/out date labels on overview during gesture
  const [showOverviewDates, setShowOverviewDates] = useState(false)
  const overviewDateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hide tooltip after touch ends (Recharts doesn't auto-dismiss on mobile)
  const [tooltipActive, setTooltipActive] = useState(true)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resolve oklch CSS variables to rgb for SVG attributes (SVG fill/stroke
  // cannot use hsl(var(...)) when the variable holds an oklch value).
  // A hidden probe div carries the Tailwind classes; getComputedStyle returns rgb.
  // Uses inline visibility:hidden instead of sr-only (clip-path:inset breaks iOS Safari).
  const probeRef = useRef<HTMLDivElement>(null)
  const [cc, setCc] = useState({ text: "#999", border: "#444", card: "#1a1a1a", fg: "#ccc" })
  useEffect(() => {
    const update = () => {
      const el = probeRef.current
      if (!el) return
      const s = getComputedStyle(el)
      setCc({
        text: s.color,
        border: s.borderColor,
        card: s.backgroundColor,
        fg: s.outlineColor,
      })
    }
    // Initial resolve + re-resolve on light/dark toggle
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])

  const views: ViewConfig[] = useMemo(
    () => [
      {
        key: "duty14" as ChartView,
        label: "14-Day Duty",
        regulation: "Reg 12(a)",
        rollingKey: "rolling14DayDuty" as keyof TimelineDataPoint,
        limitValue: limits.maxDuty14Days,
        barKey: "dutyHours" as keyof TimelineDataPoint,
        barLabel: "Duty",
        rollingLabel: "Rolling 14-Day",
        unit: "h",
        color: VIEW_COLORS.duty14,
      },
      {
        key: "duty28" as ChartView,
        label: "28-Day Duty",
        regulation: "Reg 12(b)",
        rollingKey: "rolling28DayDuty" as keyof TimelineDataPoint,
        limitValue: limits.maxDuty28Days,
        barKey: "dutyHours" as keyof TimelineDataPoint,
        barLabel: "Duty",
        rollingLabel: "Rolling 28-Day",
        unit: "h",
        color: VIEW_COLORS.duty28,
      },
      {
        key: "flight28" as ChartView,
        label: "28-Day Flight",
        regulation: "Reg 107(a)",
        rollingKey: "rolling28DayFlight" as keyof TimelineDataPoint,
        limitValue: limits.maxFlight28Days,
        barKey: "flightHours" as keyof TimelineDataPoint,
        barLabel: "Flight",
        rollingLabel: "Rolling 28-Day",
        unit: "h",
        color: VIEW_COLORS.flight28,
      },
      {
        key: "flight365" as ChartView,
        label: "12-Mo Flight",
        regulation: "Reg 107(b)",
        rollingKey: "rolling365DayFlight" as keyof TimelineDataPoint,
        limitValue: limits.maxFlight365Days,
        barKey: "flightHours" as keyof TimelineDataPoint,
        barLabel: "Flight",
        rollingLabel: "Rolling 12-Month",
        unit: "h",
        color: VIEW_COLORS.flight365,
      },
    ],
    [limits]
  )

  const isRestView = activeViews.has("rest")
  const selectedNonRestViews = useMemo(
    () => views.filter((v) => activeViews.has(v.key)),
    [activeViews, views]
  )
  const isSingleView = selectedNonRestViews.length === 1
  const primaryView = selectedNonRestViews[0]

  // Toggle handler
  const toggleView = useCallback((key: ChartView) => {
    setActiveViews((prev) => {
      if (key === "rest") return new Set(["rest"])
      if (prev.has("rest")) return new Set([key])
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size <= 1) return prev
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
    setViewWindow(null) // reset zoom on view change
  }, [])

  // Capacity for selected views — show the most constrained (bottleneck)
  const capacityForView = useMemo(() => {
    if (isRestView || selectedNonRestViews.length === 0) return null
    const caps = selectedNonRestViews.map((v) => {
      const cap =
        v.key === "duty14" ? capacity.duty14Days
          : v.key === "duty28" ? capacity.duty28Days
            : v.key === "flight28" ? capacity.flight28Days
              : capacity.flight365Days
      return { ...cap, label: v.label }
    })
    return caps.reduce((min, c) => (c.remaining < min.remaining ? c : min))
  }, [isRestView, selectedNonRestViews, capacity])

  // Today marker
  const todayStr = new Date().toISOString().split("T")[0]

  // Custom tooltip
  const CustomTooltip = useCallback(
    ({ active, payload }: { active?: boolean; payload?: Array<{ payload: TimelineDataPoint }> }) => {
      if (!active || !payload || payload.length === 0) return null
      const data = payload[0].payload

      if (isRestView) {
        if (data.restHours === null) return null
        return (
          <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs max-w-[240px]">
            <p className="font-medium text-foreground mb-1">{data.dateLabel}</p>
            <div className="space-y-1">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Rest</span>
                <span className={cn("font-medium", !data.restCompliant && "text-red-500")}>
                  {data.restHours!.toFixed(1)}h
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Required</span>
                <span className="font-medium">{data.restRequired!.toFixed(0)}h</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Rule</span>
                <span className="font-medium">{data.restRule}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Status</span>
                <span className={cn("font-medium", data.restCompliant ? "text-green-500" : "text-red-500")}>
                  {data.restCompliant ? "Compliant" : "Violation"}
                </span>
              </div>
            </div>
            {data.isFuture && (
              <p className="text-muted-foreground mt-1 italic">Scheduled</p>
            )}
          </div>
        )
      }

      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs max-w-[260px]">
          <p className="font-medium text-foreground mb-1.5">
            {data.dateLabel}
            {data.isFuture && <span className="text-muted-foreground ml-1">(scheduled)</span>}
          </p>
          {/* Daily values */}
          <div className="space-y-0.5 mb-1.5">
            {data.dutyHours > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Duty</span>
                <span className="font-medium">{data.dutyHours.toFixed(1)}h</span>
              </div>
            )}
            {data.flightHours > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Flight</span>
                <span className="font-medium">{data.flightHours.toFixed(1)}h</span>
              </div>
            )}
          </div>
          {/* Rolling values for each selected view */}
          <div className="space-y-1 border-t border-border pt-1.5">
            {selectedNonRestViews.map((view) => {
              const rollingValue = data[view.rollingKey] as number
              const pct = view.limitValue > 0 ? ((rollingValue / view.limitValue) * 100).toFixed(0) : "0"
              return (
                <div key={view.key}>
                  <div className="flex justify-between gap-3">
                    <span style={{ color: view.color }} className="font-medium">{view.rollingLabel}</span>
                    <span className="font-medium">{rollingValue.toFixed(1)}h / {view.limitValue}h</span>
                  </div>
                  <div className="flex justify-end">
                    <span className={cn(
                      "text-[10px]",
                      Number(pct) >= 100 ? "text-red-500" :
                        Number(pct) >= 90 ? "text-orange-500" :
                          Number(pct) >= 75 ? "text-yellow-500" : "text-green-500"
                    )}>
                      {pct}% utilized
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-1 pt-1 border-t border-border text-muted-foreground">
            Source: {data.source}
          </div>
        </div>
      )
    },
    [isRestView, selectedNonRestViews]
  )

  // Filter rest data to only entries with rest info
  const restData = useMemo(
    () => timelineData.filter((d) => d.restHours !== null),
    [timelineData]
  )

  // Unique bar keys across selected views
  const uniqueBarKeys = useMemo(() => {
    const keys = new Set(selectedNonRestViews.map((v) => v.barKey))
    return Array.from(keys) as (keyof TimelineDataPoint)[]
  }, [selectedNonRestViews])

  // Y-axis domain for multi-select
  const yDomain = useMemo(() => {
    if (selectedNonRestViews.length === 0) return undefined
    const maxLimit = Math.max(...selectedNonRestViews.map((v) => v.limitValue))
    return [0, Math.ceil(maxLimit * 1.1)]
  }, [selectedNonRestViews])

  // Compute the sliced data for the visible window
  const activeData = isRestView ? restData : timelineData
  const slicedData = useMemo(() => {
    if (!activeData.length) return activeData
    if (!viewWindow) {
      // Default: show last DEFAULT_WINDOW days or all if shorter
      const start = Math.max(0, activeData.length - DEFAULT_WINDOW)
      return activeData.slice(start)
    }
    return activeData.slice(viewWindow.start, viewWindow.end + 1)
  }, [activeData, viewWindow])

  // Effective window for gesture calculations
  const effectiveWindow = useMemo(() => {
    if (!activeData.length) return { start: 0, end: 0 }
    if (!viewWindow) {
      return { start: Math.max(0, activeData.length - DEFAULT_WINDOW), end: activeData.length - 1 }
    }
    return viewWindow
  }, [activeData, viewWindow])

  // Overview edge date labels (shown during gesture, fade after release)
  const overviewStartLabel = activeData[effectiveWindow.start]?.dateLabel ?? ""
  const overviewEndLabel = activeData[effectiveWindow.end]?.dateLabel ?? ""

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
      const windowSize = gestureRef.current.startWindow.end - gestureRef.current.startWindow.start
      const dataPxRatio = windowSize / ww
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
    // Fade out overview dates after 1.5s
    if (overviewDateTimerRef.current) clearTimeout(overviewDateTimerRef.current)
    overviewDateTimerRef.current = setTimeout(() => setShowOverviewDates(false), 1500)
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
    setShowOverviewDates(true)
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

  // X-axis tick interval — show ~6 labels max to avoid clutter
  const xAxisInterval = useMemo(() => {
    if (slicedData.length <= 7) return 0
    return Math.max(1, Math.floor(slicedData.length / 6) - 1)
  }, [slicedData.length])

  // Shared axis/grid theme props — using resolved rgb from probe
  const axisTickStyle = { fontSize: 10, fill: cc.text }
  const gridStroke = cc.border

  return (
    <div className="space-y-3">
      {/* Hidden probe to resolve oklch CSS vars → rgb for SVG.
          Uses visibility:hidden (not sr-only) because clip-path:inset(50%) in sr-only
          prevents getComputedStyle from resolving oklch on iOS Safari. */}
      <div
        ref={probeRef}
        className="text-muted-foreground border-border bg-card outline-foreground"
        style={{ position: "absolute", visibility: "hidden", pointerEvents: "none" }}
        aria-hidden="true"
      />
      {/* View selector tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {views.map((view) => {
          const cap = view.key === "duty14" ? capacity.duty14Days
            : view.key === "duty28" ? capacity.duty28Days
              : view.key === "flight28" ? capacity.flight28Days
                : capacity.flight365Days
          const pct = cap.limit > 0 ? (cap.used / cap.limit) * 100 : 0
          const isActive = activeViews.has(view.key)
          const isMulti = activeViews.size > 1 && !isRestView

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
              className={cn(
                "flex flex-col items-start px-3 py-2 rounded-lg text-left transition-all min-w-[120px] shrink-0 relative",
                isActive
                  ? isMulti
                    ? "bg-secondary shadow-sm text-foreground"
                    : "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary/50 hover:bg-secondary text-foreground"
              )}
              style={isActive && isMulti ? { boxShadow: `0 0 0 2px ${view.color}` } : undefined}
            >
              {isActive && isMulti && (
                <div
                  className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: view.color }}
                >
                  <Check className="h-2.5 w-2.5 text-white" />
                </div>
              )}
              <span className="text-xs font-medium">{view.label}</span>
              <span className={cn(
                "text-[10px]",
                isActive && !isMulti ? "text-primary-foreground/70" : "text-muted-foreground"
              )}>
                {view.regulation}
              </span>
              {/* Prominent used / limit display */}
              <span className={cn(
                "text-sm font-semibold tabular-nums mt-0.5",
                isActive && !isMulti ? "text-primary-foreground" : "text-foreground"
              )}>
                {cap.used.toFixed(0)}h / {cap.limit}h
              </span>
              <div className="flex items-center gap-1.5 mt-1 w-full">
                <div className={cn(
                  "h-1.5 rounded-full flex-1 min-w-[60px]",
                  isActive && !isMulti ? "bg-primary-foreground/20" : "bg-muted"
                )}>
                  <div
                    className={cn("h-full rounded-full transition-all", barColor)}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <span className={cn(
                  "text-[10px] font-semibold whitespace-nowrap",
                  isActive && !isMulti ? "text-primary-foreground" : remainingColor
                )}>
                  {cap.remaining.toFixed(0)}h left
                </span>
              </div>
            </button>
          )
        })}

        {/* Rest period tab */}
        <button
          onClick={() => toggleView("rest")}
          className={cn(
            "flex flex-col items-start px-3 py-2 rounded-lg text-left transition-all min-w-[120px] shrink-0",
            isRestView
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-secondary/50 hover:bg-secondary text-foreground"
          )}
        >
          <span className="text-xs font-medium">Rest Periods</span>
          <span className={cn("text-[10px]", isRestView ? "text-primary-foreground/70" : "text-muted-foreground")}>
            Reg 3
          </span>
          {restData.some((d) => !d.restCompliant) && (
            <Badge variant="outline" className={cn("text-[9px] h-4 mt-1", isRestView ? "border-primary-foreground/30 text-primary-foreground" : "border-red-500/30 text-red-500")}>
              Violations
            </Badge>
          )}
        </button>
      </div>

      {/* Current capacity summary */}
      {!isRestView && capacityForView && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">
            {capacityForView.used.toFixed(1)}h used of {capacityForView.limit}h
            {selectedNonRestViews.length > 1 && (
              <span className="ml-1">({(capacityForView as { label: string }).label})</span>
            )}
          </span>
          <span className={cn(
            "text-xs font-medium",
            capacityForView.remaining <= 0 ? "text-red-500"
              : capacityForView.remaining < capacityForView.limit * 0.1 ? "text-orange-500"
                : "text-green-500"
          )}>
            {capacityForView.remaining.toFixed(1)}h remaining
          </span>
        </div>
      )}

      {/* Chart */}
      <Card className="shadow-sm">
        <CardContent className="pt-4 pb-2 px-2 relative">
          {/* Zoom controls — top right */}
          <div className="absolute top-2 right-2 flex items-center gap-0.5 z-20">
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
          </div>
          {(isRestView ? restData.length === 0 : timelineData.length === 0) ? (
            <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
              No data to display
            </div>
          ) : isRestView ? (
            /* Rest period chart — single finger on chart body = tooltip,
               single finger on axis zone = pan, two fingers = pinch zoom */
            <div
              ref={chartWrapperRef}
              onTouchStart={handleChartTouchStart}
              onTouchMove={handleGestureMove}
              onTouchEnd={handleGestureEnd}
              className="touch-none relative"
            >
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={slicedData} margin={{ top: 5, right: CHART_RIGHT_PX, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} opacity={0.3} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={axisTickStyle}
                    tickLine={false}
                    axisLine={false}
                    interval={xAxisInterval}
                  />
                  <YAxis
                    tick={axisTickStyle}
                    tickLine={false}
                    axisLine={false}
                    unit="h"
                    width={CHART_LEFT_PX}
                  />
                  <Tooltip content={<CustomTooltip />} active={tooltipActive ? undefined : false} />

                  {/* Required rest as a line */}
                  <Line
                    dataKey="restRequired"
                    stroke={cc.text}
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    dot={false}
                    name="Required"
                  />

                  {/* Actual rest as bars colored by compliance */}
                  <Bar dataKey="restHours" radius={[3, 3, 0, 0]} maxBarSize={24} name="Rest">
                    {slicedData.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={entry.restCompliant ? COLORS.restBar : COLORS.violation}
                        opacity={entry.isFuture ? 0.4 : 0.85}
                      />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            /* Duty/Flight rolling chart — supports multi-select */
            <div
              ref={chartWrapperRef}
              onTouchStart={handleChartTouchStart}
              onTouchMove={handleGestureMove}
              onTouchEnd={handleGestureEnd}
              className="touch-none relative"
            >
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={slicedData} margin={{ top: 5, right: CHART_RIGHT_PX, left: 0, bottom: 5 }}>
                  <defs>
                    {selectedNonRestViews.map((view) => (
                      <linearGradient key={view.key} id={`gradient-${view.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={view.color} stopOpacity={isSingleView ? 0.5 : 0.35} />
                        <stop offset="95%" stopColor={view.color} stopOpacity={0.08} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} opacity={0.3} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={axisTickStyle}
                    tickLine={false}
                    axisLine={false}
                    interval={xAxisInterval}
                  />
                  <YAxis
                    tick={axisTickStyle}
                    tickLine={false}
                    axisLine={false}
                    unit="h"
                    width={CHART_LEFT_PX}
                    domain={yDomain}
                  />
                  <Tooltip content={<CustomTooltip />} active={tooltipActive ? undefined : false} />

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

                  {/* Today marker */}
                  {slicedData.some((d) => d.date === todayStr) && (
                    <ReferenceLine
                      x={slicedData.find((d) => d.date === todayStr)?.dateLabel}
                      stroke={cc.fg}
                      strokeDasharray="2 2"
                      strokeWidth={1}
                      opacity={0.4}
                      label={{
                        value: "Today",
                        position: "top",
                        fill: cc.text,
                        fontSize: 9,
                      }}
                    />
                  )}

                  {/* Future region overlay — subtle dimming after today */}
                  {(() => {
                    const todayIdx = slicedData.findIndex((d) => d.date === todayStr)
                    if (todayIdx >= 0 && todayIdx < slicedData.length - 1) {
                      return (
                        <ReferenceArea
                          x1={slicedData[todayIdx].dateLabel}
                          x2={slicedData[slicedData.length - 1].dateLabel}
                          fill={cc.card}
                          fillOpacity={0.3}
                          strokeOpacity={0}
                        />
                      )
                    }
                    return null
                  })()}

                  {/* Rolling cumulative areas — one per selected view */}
                  {selectedNonRestViews.map((view) => (
                    <Area
                      key={`area-${view.key}`}
                      dataKey={view.rollingKey}
                      fill={`url(#gradient-${view.key})`}
                      stroke={view.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={false}
                      name={view.rollingLabel}
                    />
                  ))}

                  {/* Daily bars — duty: blue, flight: yellow */}
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
                      >
                        {slicedData.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={barColor}
                            opacity={entry.isFuture ? 0.3 : 0.7}
                          />
                        ))}
                      </Bar>
                    )
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Overview mini-chart — "big picture" with rolling lines + active window */}
          {activeData.length > 0 && (
            <div
              ref={overviewRef}
              onTouchStart={handleOverviewTouchStart}
              onTouchMove={handleGestureMove}
              onTouchEnd={handleGestureEnd}
              className="relative mt-2 touch-none cursor-grab active:cursor-grabbing select-none"
            >
              {/* Mini chart showing full dataset with rolling lines + shaded fill */}
              <div className="overflow-hidden" style={{ marginLeft: CHART_LEFT_PX, marginRight: CHART_RIGHT_PX }}>
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
                    {isRestView ? (
                      <Bar dataKey="restHours" maxBarSize={4} isAnimationActive={false}>
                        {activeData.map((entry, i) => (
                          <Cell key={i} fill={entry.restCompliant ? COLORS.restBar : COLORS.violation} opacity={0.6} />
                        ))}
                      </Bar>
                    ) : (
                      <>
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
                      </>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Darkened left region */}
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left: CHART_LEFT_PX,
                  width: `calc((100% - ${CHART_LEFT_PX + CHART_RIGHT_PX}px) * ${overviewHighlight.leftPct / 100})`,
                  backgroundColor: cc.card,
                  opacity: 0.75,
                }}
              />
              {/* Darkened right region */}
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  right: CHART_RIGHT_PX,
                  width: `calc((100% - ${CHART_LEFT_PX + CHART_RIGHT_PX}px) * ${overviewHighlight.rightPct / 100})`,
                  backgroundColor: cc.card,
                  opacity: 0.75,
                }}
              />
              {/* Active window box with rounded border */}
              <div
                className="absolute top-0 bottom-0 border border-foreground/40 rounded-md pointer-events-none"
                style={{
                  left: `calc(${CHART_LEFT_PX}px + (100% - ${CHART_LEFT_PX + CHART_RIGHT_PX}px) * ${overviewHighlight.leftPct / 100})`,
                  width: `calc((100% - ${CHART_LEFT_PX + CHART_RIGHT_PX}px) * ${overviewHighlight.widthPct / 100})`,
                }}
              >
                {/* Edge grab handles */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[3px] w-1.5 h-5 rounded-full bg-foreground/40" />
                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-[3px] w-1.5 h-5 rounded-full bg-foreground/40" />
              </div>

              {/* Fade-in/out date labels at edges of active window */}
              <div
                className="absolute top-0 bottom-0 pointer-events-none transition-opacity duration-500"
                style={{
                  left: `calc(${CHART_LEFT_PX}px + (100% - ${CHART_LEFT_PX + CHART_RIGHT_PX}px) * ${overviewHighlight.leftPct / 100})`,
                  width: `calc((100% - ${CHART_LEFT_PX + CHART_RIGHT_PX}px) * ${overviewHighlight.widthPct / 100})`,
                  opacity: showOverviewDates ? 1 : 0,
                }}
              >
                <span className="absolute -top-3.5 left-0 -translate-x-1/2 text-[9px] text-muted-foreground tabular-nums whitespace-nowrap bg-card/80 px-0.5 rounded">
                  {overviewStartLabel}
                </span>
                <span className="absolute -top-3.5 right-0 translate-x-1/2 text-[9px] text-muted-foreground tabular-nums whitespace-nowrap bg-card/80 px-0.5 rounded">
                  {overviewEndLabel}
                </span>
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      {/* Forecast exceedance warnings */}
      {!isRestView && forecast.hasExceedance && (
        <div className="space-y-1.5">
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
            .map((exc, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20"
              >
                <span className="text-red-500 font-medium">
                  {(() => { const d = new Date(exc.date + "T00:00:00Z"); return `${d.getUTCDate().toString().padStart(2, "0")} ${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}`; })()}
                </span>
                <span className="text-red-500">
                  {exc.projected.toFixed(1)}h / {exc.limit}h — breach
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
