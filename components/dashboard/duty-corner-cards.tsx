"use client"

import * as React from "react"
import Link from "next/link"
import { Briefcase, Timer } from "lucide-react"

import { useFDPData } from "@/hooks/data/use-fdp-data"
import { cn } from "@/lib/utils"

function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0.0"
  return hours.toFixed(1)
}

interface CardProps {
  label: string
  value: string
  unit: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  tone: string
  className?: string
  hint?: string
}

function CornerCard({ label, value, unit, icon: Icon, href, tone, className, hint }: CardProps) {
  return (
    <Link
      href={href}
      aria-label={`${label} ${value} ${unit}`}
      className={cn(
        "group flex flex-col justify-between gap-1 rounded-2xl border border-border/60 bg-card/70 p-3 sm:p-4 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon className={cn("h-3.5 w-3.5", tone)} />
      </div>
      <div>
        <p className="font-mono tabular-nums text-xl sm:text-2xl font-bold text-foreground leading-tight">
          {value}
          <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>
        </p>
        {hint && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>
        )}
      </div>
    </Link>
  )
}

export function FlightDutyCard({ className }: { className?: string }) {
  const { cumulativeLimits } = useFDPData()
  return (
    <CornerCard
      label="Flight Duty"
      value={formatHours(cumulativeLimits.last28Days.flightHours)}
      unit="h"
      hint="Last 28 days"
      icon={Timer}
      href="/fdp"
      tone="text-chart-2"
      className={className}
    />
  )
}

export function DutyPeriodCard({ className }: { className?: string }) {
  const { cumulativeLimits } = useFDPData()
  return (
    <CornerCard
      label="Duty Period"
      value={formatHours(cumulativeLimits.last28Days.dutyHours)}
      unit="h"
      hint="Last 28 days"
      icon={Briefcase}
      href="/fdp"
      tone="text-chart-4"
      className={className}
    />
  )
}
