"use client"

import { useState, useMemo, useCallback } from "react"
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
  Area,
  Brush,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Check } from "lucide-react"
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

const VIEW_COLORS: Record<string, string> = {
  duty14: "hsl(217, 91%, 60%)",   // blue
  duty28: "hsl(270, 67%, 58%)",   // purple
  flight28: "hsl(142, 71%, 45%)", // green
  flight365: "hsl(25, 95%, 53%)", // orange
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
      // Rest is mutually exclusive
      if (key === "rest") {
        return new Set(["rest"])
      }
      // If rest is selected and user picks non-rest, replace
      if (prev.has("rest")) {
        return new Set([key])
      }
      const next = new Set(prev)
      if (next.has(key)) {
        // Don't deselect the last one
        if (next.size <= 1) return prev
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
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
    // Return the one with least remaining (bottleneck)
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
                <span>{data.restRequired!.toFixed(0)}h</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Rule</span>
                <span>{data.restRule}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Status</span>
                <span className={data.restCompliant ? "text-green-500" : "text-red-500"}>
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

  return (
    <div className="space-y-3">
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
                    ? "bg-secondary shadow-sm text-foreground ring-2"
                    : "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary/50 hover:bg-secondary text-foreground"
              )}
              style={isActive && isMulti ? { ringColor: view.color, borderColor: view.color, outlineColor: view.color } : undefined}
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
      <Card>
        <CardContent className="pt-4 pb-2 px-2">
          {(isRestView ? restData.length === 0 : timelineData.length === 0) ? (
            <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
              No data to display
            </div>
          ) : isRestView ? (
            /* Rest period chart */
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={restData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.3} />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  unit="h"
                  width={40}
                />
                <Tooltip content={<CustomTooltip />} />

                {/* Required rest as a line */}
                <Line
                  dataKey="restRequired"
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  name="Required"
                />

                {/* Actual rest as bars colored by compliance */}
                <Bar dataKey="restHours" radius={[3, 3, 0, 0]} maxBarSize={24} name="Rest">
                  {restData.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={
                        entry.restCompliant
                          ? "hsl(142, 71%, 45%)"
                          : "hsl(0, 84%, 60%)"
                      }
                      opacity={entry.isFuture ? 0.5 : 0.85}
                    />
                  ))}
                </Bar>
                <Brush
                  dataKey="dateLabel"
                  height={24}
                  stroke="hsl(var(--border))"
                  fill="hsl(var(--card))"
                  travellerWidth={10}
                  startIndex={Math.max(0, restData.length - 90)}
                  tickFormatter={() => ""}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            /* Duty/Flight rolling chart — supports multi-select */
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={timelineData} margin={{ top: 5, right: 60, left: 0, bottom: 5 }}>
                <defs>
                  {selectedNonRestViews.map((view) => (
                    <linearGradient key={view.key} id={`gradient-${view.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={view.color} stopOpacity={isSingleView ? 0.3 : 0.2} />
                      <stop offset="95%" stopColor={view.color} stopOpacity={0.03} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.3} />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  unit="h"
                  width={40}
                  domain={yDomain}
                />
                <Tooltip content={<CustomTooltip />} />

                {/* Limit threshold lines — one per selected view */}
                {selectedNonRestViews.map((view) => (
                  <ReferenceLine
                    key={`limit-${view.key}`}
                    y={view.limitValue}
                    stroke={isSingleView ? "hsl(0, 84%, 60%)" : view.color}
                    strokeDasharray="6 3"
                    strokeWidth={1.5}
                    label={{
                      value: `${view.limitValue}h`,
                      position: "right",
                      fill: isSingleView ? "hsl(0, 84%, 60%)" : view.color,
                      fontSize: 10,
                    }}
                  />
                ))}

                {/* Warning threshold (90%) — only for single view */}
                {isSingleView && primaryView && (
                  <ReferenceLine
                    y={primaryView.limitValue * 0.9}
                    stroke="hsl(25, 95%, 53%)"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                    opacity={0.5}
                  />
                )}

                {/* Today marker */}
                {timelineData.some((d) => d.date === todayStr) && (
                  <ReferenceLine
                    x={timelineData.find((d) => d.date === todayStr)?.dateLabel}
                    stroke="hsl(var(--foreground))"
                    strokeDasharray="2 2"
                    strokeWidth={1}
                    opacity={0.4}
                    label={{
                      value: "Today",
                      position: "top",
                      fill: "hsl(var(--muted-foreground))",
                      fontSize: 9,
                    }}
                  />
                )}

                {/* Rolling cumulative areas — one per selected view */}
                {selectedNonRestViews.map((view) => (
                  <Area
                    key={`area-${view.key}`}
                    dataKey={view.rollingKey}
                    fill={`url(#gradient-${view.key})`}
                    stroke={view.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2 }}
                    name={view.rollingLabel}
                  />
                ))}

                {/* Daily bars — one per unique barKey */}
                {uniqueBarKeys.map((barKey, barIdx) => {
                  const barView = selectedNonRestViews.find((v) => v.barKey === barKey)!
                  return (
                    <Bar
                      key={`bar-${barKey}`}
                      dataKey={barKey}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={uniqueBarKeys.length > 1 ? 12 : 16}
                      name={barView.barLabel}
                    >
                      {timelineData.map((entry, index) => (
                        <Cell
                          key={index}
                          fill={
                            uniqueBarKeys.length > 1
                              ? barIdx === 0 ? "hsl(142, 71%, 45%)" : "hsl(217, 91%, 60%)"
                              : entry.isFuture ? "hsl(217, 91%, 60%)" : "hsl(142, 71%, 45%)"
                          }
                          opacity={entry.isFuture ? 0.4 : 0.7}
                        />
                      ))}
                    </Bar>
                  )
                })}
                <Brush
                  dataKey="dateLabel"
                  height={24}
                  stroke="hsl(var(--border))"
                  fill="hsl(var(--card))"
                  travellerWidth={10}
                  startIndex={Math.max(0, timelineData.length - 90)}
                  tickFormatter={() => ""}
                />
              </ComposedChart>
            </ResponsiveContainer>
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
