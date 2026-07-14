"use client"

import * as React from "react"
import Link from "next/link"
import { Bell, AlertCircle, ShieldAlert, Award } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useExpiringCurrencies } from "@/hooks/data"
import { useUnresolvedDiscrepancies } from "@/hooks/data/use-discrepancies"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { cn } from "@/lib/utils"

interface AlertItem {
  id: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  detail: string
  href: string
  tone: "warn" | "critical" | "info"
}

const TONE_CLASSES: Record<AlertItem["tone"], string> = {
  warn: "text-chart-4",
  critical: "text-destructive",
  info: "text-muted-foreground",
}

export function AlertsDropdown() {
  const { expiringCurrencies } = useExpiringCurrencies()
  const { unresolvedDiscrepancies } = useUnresolvedDiscrepancies()
  const { cumulativeLimits, restUntilLegal } = useFDPData()

  const alerts: AlertItem[] = []

  for (const c of expiringCurrencies.slice(0, 5)) {
    const days = c.daysRemaining
    const tone: AlertItem["tone"] = days <= 0 ? "critical" : days <= 7 ? "critical" : "warn"
    alerts.push({
      id: `cur-${c.id ?? c.code}`,
      icon: Award,
      label: c.code,
      detail: days <= 0 ? "Expired" : `${days}d remaining`,
      href: "/currencies",
      tone,
    })
  }

  for (const d of unresolvedDiscrepancies.slice(0, 5)) {
    alerts.push({
      id: `disc-${d.id}`,
      icon: AlertCircle,
      label: d.type ?? "Discrepancy",
      detail: d.message ?? "Unresolved",
      href: "/discrepancies",
      tone: d.severity === "error" ? "critical" : "warn",
    })
  }

  const fdpUtil = Math.max(
    cumulativeLimits.last14Days.utilizationPercent,
    cumulativeLimits.last28Days.utilizationPercent,
    cumulativeLimits.last365Days.utilizationPercent,
  )
  if (fdpUtil >= 80) {
    alerts.push({
      id: "fdp-util",
      icon: ShieldAlert,
      label: "FDP usage high",
      detail: `${Math.round(fdpUtil)}% of regulatory limit`,
      href: "/fdp",
      tone: fdpUtil >= 95 ? "critical" : "warn",
    })
  }
  if (restUntilLegal && !restUntilLegal.isLegalNow) {
    alerts.push({
      id: "rest-required",
      icon: ShieldAlert,
      label: "Rest required",
      detail: "Not yet legal for next duty",
      href: "/fdp",
      tone: "warn",
    })
  }

  const count = alerts.length
  const hasCritical = alerts.some((a) => a.tone === "critical")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Alerts${count > 0 ? `, ${count}` : ""}`}
          className="relative h-12 w-12 rounded-full"
        >
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span
              className={cn(
                "absolute top-1 right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white",
                hasCritical ? "bg-destructive" : "bg-chart-4",
              )}
            >
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-2">
        <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Alerts
        </div>
        {count === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            All clear. No alerts.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {alerts.map((a) => (
              <li key={a.id}>
                <Link
                  href={a.href}
                  className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/40"
                >
                  <a.icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_CLASSES[a.tone])} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{a.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.detail}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
