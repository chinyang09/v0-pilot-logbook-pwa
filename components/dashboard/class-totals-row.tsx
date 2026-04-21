"use client"

import * as React from "react"
import { Plane, RotateCcw, Wind, GraduationCap } from "lucide-react"

import { DashboardWidget, WidgetLabel, WidgetValue } from "./dashboard-widget"
import type { DashboardAggregates } from "@/lib/utils/dashboard-aggregate"
import { formatDecimalHours } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

interface ClassTotalsRowProps {
  byCategory: DashboardAggregates["byCategory"]
  dualMinutes: number
  className?: string
}

export function ClassTotalsRow({ byCategory, dualMinutes, className }: ClassTotalsRowProps) {
  const items = [
    {
      label: "Airplane",
      value: byCategory.airplane,
      icon: Plane,
      tone: "text-chart-2",
      href: "/aircraft",
    },
    {
      label: "Rotorcraft",
      value: byCategory.rotorcraft,
      icon: RotateCcw,
      tone: "text-chart-4",
      href: "/aircraft",
    },
    {
      label: "Glider",
      value: byCategory.glider,
      icon: Wind,
      tone: "text-chart-3",
      href: "/aircraft",
    },
    {
      label: "Dual",
      value: dualMinutes,
      icon: GraduationCap,
      tone: "text-chart-5",
      href: "/logbook",
    },
  ]

  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3", className)}>
      {items.map((item) => (
        <DashboardWidget key={item.label} href={item.href} ariaLabel={`${item.label} hours`} className="p-3">
          <div className="flex items-start justify-between gap-2">
            <WidgetLabel>{item.label}</WidgetLabel>
            <item.icon className={cn("h-3.5 w-3.5", item.tone)} />
          </div>
          <WidgetValue className="mt-1 text-xl sm:text-2xl font-bold">
            {formatDecimalHours(item.value)}
          </WidgetValue>
        </DashboardWidget>
      ))}
    </div>
  )
}
