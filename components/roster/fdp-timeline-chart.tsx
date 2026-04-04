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
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
  const [activeView, setActiveView] = useState<ChartView>("duty14")

  const views: ViewConfig[] = useMemo(
    () => [
      {
        key: "duty14",
        label: "14-Day Duty",
        regulation: "Reg 12(a)",
        rollingKey: "rolling14DayDuty",
        limitValue: limits.maxDuty14Days,
        barKey: "dutyHours",
        barLabel: "Duty",
        rollingLabel: "Rolling 14-Day",
        unit: "h",
      },
      {
        key: "duty28",
        label: "28-Day Duty",
        regulation: "Reg 12(b)",
        rollingKey: "rolling28DayDuty",
        limitValue: limits.maxDuty28Days,
        barKey: "dutyHours",
        barLabel: "Duty",
        rollingLabel: "Rolling 28-Day",
        unit: "h",
      },
      {
        key: "flight28",
        label: "28-Day Flight",
        regulation: "Reg 107(a)",
        rollingKey: "rolling28DayFlight",
        limitValue: limits.maxFlight28Days,
        barKey: "flightHours",
        barLabel: "Flight",
        rollingLabel: "Rolling 28-Day",
        unit: "h",
      },
      {
        key: "flight365",
        label: "12-Mo Flight",
        regulation: "Reg 107(b)",
        rollingKey: "rolling365DayFlight",
        limitValue: limits.maxFlight365Days,
        barKey: "flightHours",
        barLabel: "Flight",
        rollingLabel: "Rolling 12-Month",
        unit: "h",
      },
    ],
    [limits]
  )

  const currentView = views.find((v) => v.key === activeView)!
  const isRestView = activeView === "rest"

  // Capacity for the selected view
  const capacityForView: { used: number; limit: number; remaining: number } | null =
    activeView === "duty14"
      ? capacity.duty14Days
      : activeView === "duty28"
        ? capacity.duty28Days
        : activeView === "flight28"
          ? capacity.flight28Days
          : activeView === "flight365"
            ? capacity.flight365Days
            : null

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
          <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs max-w-[220px]">
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

      const rollingValue = data[currentView.rollingKey] as number
      const pct = currentView.limitValue > 0 ? ((rollingValue / currentView.limitValue) * 100).toFixed(0) : "0"

      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs max-w-[220px]">
          <p className="font-medium text-foreground mb-1">
            {data.dateLabel}
            {data.isFuture && <span className="text-muted-foreground ml-1">(scheduled)</span>}
          </p>
          <div className="space-y-1">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{currentView.barLabel}</span>
              <span className="font-medium">{(data[currentView.barKey] as number).toFixed(1)}h</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{currentView.rollingLabel}</span>
              <span className="font-medium">{rollingValue.toFixed(1)}h / {currentView.limitValue}h</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Utilization</span>
              <span className={cn(
                "font-medium",
                Number(pct) >= 100 ? "text-red-500" :
                  Number(pct) >= 90 ? "text-orange-500" :
                    Number(pct) >= 75 ? "text-yellow-500" : "text-green-500"
              )}>
                {pct}%
              </span>
            </div>
          </div>
          <div className="mt-1 pt-1 border-t border-border text-muted-foreground">
            Source: {data.source}
          </div>
        </div>
      )
    },
    [isRestView, currentView]
  )

  // Filter rest data to only entries with rest info
  const restData = useMemo(
    () => timelineData.filter((d) => d.restHours !== null),
    [timelineData]
  )

  const chartData = isRestView ? restData : timelineData

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
          const isActive = activeView === view.key

          return (
            <button
              key={view.key}
              onClick={() => setActiveView(view.key)}
              className={cn(
                "flex flex-col items-start px-3 py-2 rounded-lg text-left transition-all min-w-[120px] shrink-0",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary/50 hover:bg-secondary text-foreground"
              )}
            >
              <span className="text-xs font-medium">{view.label}</span>
              <span className={cn("text-[10px]", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                {view.regulation}
              </span>
              <div className="flex items-center gap-1 mt-1">
                <div className={cn("h-1 rounded-full flex-1 min-w-[60px]", isActive ? "bg-primary-foreground/20" : "bg-secondary")}>
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      pct >= 100 ? "bg-red-500"
                        : pct >= 90 ? "bg-orange-500"
                          : pct >= 75 ? "bg-yellow-500"
                            : isActive ? "bg-primary-foreground" : "bg-green-500"
                    )}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <span className={cn("text-[10px] font-medium", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {cap.remaining.toFixed(0)}h
                </span>
              </div>
            </button>
          )
        })}

        {/* Rest period tab */}
        <button
          onClick={() => setActiveView("rest")}
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

      {/* Current capacity summary for selected view */}
      {!isRestView && capacityForView && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">
            {capacityForView.used.toFixed(1)}h used of {capacityForView.limit}h
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
          {chartData.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
              No data to display
            </div>
          ) : isRestView ? (
            /* Rest period chart */
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={restData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
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
                          ? "hsl(142, 71%, 45%)"   // green
                          : "hsl(0, 84%, 60%)"     // red
                      }
                      opacity={entry.isFuture ? 0.5 : 0.85}
                    />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            /* Duty/Flight rolling chart */
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={timelineData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <defs>
                  <linearGradient id="rollingGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.05} />
                  </linearGradient>
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
                />
                <Tooltip content={<CustomTooltip />} />

                {/* Limit threshold line */}
                <ReferenceLine
                  y={currentView.limitValue}
                  stroke="hsl(0, 84%, 60%)"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{
                    value: `${currentView.limitValue}h limit`,
                    position: "right",
                    fill: "hsl(0, 84%, 60%)",
                    fontSize: 10,
                  }}
                />

                {/* Warning threshold (90%) */}
                <ReferenceLine
                  y={currentView.limitValue * 0.9}
                  stroke="hsl(25, 95%, 53%)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  opacity={0.5}
                />

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

                {/* Rolling cumulative area */}
                <Area
                  dataKey={currentView.rollingKey}
                  fill="url(#rollingGradient)"
                  stroke="hsl(217, 91%, 60%)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2 }}
                  name={currentView.rollingLabel}
                />

                {/* Daily bars */}
                <Bar dataKey={currentView.barKey} radius={[2, 2, 0, 0]} maxBarSize={16} name={currentView.barLabel}>
                  {timelineData.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={
                        entry.isFuture
                          ? "hsl(217, 91%, 60%)"   // blue for future
                          : "hsl(142, 71%, 45%)"    // green for past
                      }
                      opacity={entry.isFuture ? 0.4 : 0.7}
                    />
                  ))}
                </Bar>
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
              // Show exceedances relevant to current view
              if (activeView === "duty14") return exc.limitName.includes("14-day duty")
              if (activeView === "duty28") return exc.limitName.includes("28-day duty")
              if (activeView === "flight28") return exc.limitName.includes("28-day flight")
              if (activeView === "flight365") return exc.limitName.includes("12-month flight")
              return true
            })
            .map((exc, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20"
              >
                <span className="text-red-500 font-medium">
                  {new Date(exc.date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
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
