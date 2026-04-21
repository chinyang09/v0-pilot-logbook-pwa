"use client"

import * as React from "react"
import Link from "next/link"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/providers/auth-provider"
import { AlertsDropdown } from "./alerts-dropdown"

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return "Good night"
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

function todayLabel(): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date())
}

export function DashboardHeader() {
  const { user } = useAuth()
  const greeting = React.useMemo(getGreeting, [])
  const date = React.useMemo(todayLabel, [])
  const callsign = user?.callsign ?? "Pilot"
  const initials = callsign.slice(0, 2).toUpperCase()

  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-sm"
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base sm:text-lg font-semibold text-foreground leading-tight">
            <span className="text-muted-foreground font-normal">{greeting}, </span>
            <span className="text-primary">{callsign}</span>
          </p>
          <p className="text-xs text-muted-foreground leading-tight">{date}</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label="Edit account"
          className="rounded-full"
        >
          <Link href="/account">
            <Pencil className="h-4 w-4" />
          </Link>
        </Button>
        <AlertsDropdown />
      </div>
    </header>
  )
}
