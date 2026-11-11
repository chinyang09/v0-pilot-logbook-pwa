"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, List } from "lucide-react"
import { GlassButtonGroup } from "@/components/ui/glass-icon-button"
import { rememberLogbookView, type LogbookView } from "@/hooks/use-logbook-view"
import { cn } from "@/lib/utils"

const VIEWS: { value: LogbookView; label: string; icon: typeof List }[] = [
  { value: "/logbook", label: "List", icon: List },
  { value: "/roster", label: "Roster", icon: CalendarDays },
]

/**
 * The Logbook tab's page switch — the LIST of flights, or the ROSTER (the
 * month and the day-by-day agenda with duties). FIRST in the header, its own
 * capsule, like the dashboard's Legal | Summary (`glass-icon-button.tsx`).
 *
 * Icons rather than words, deliberately: the logbook's header already holds
 * View, Tools and Create, and with two words more the left group reached the
 * centred nav pill on a 1180 tablet. A list and a calendar are things an icon
 * does say; each carries its name for a screen reader and a tooltip.
 */
export function LogbookViewSwitch({ current, active }: { current: LogbookView; active: boolean }) {
  const router = useRouter()
  // The Logbook tab goes back to whichever view was on screen last.
  useEffect(() => {
    if (active) rememberLogbookView(current)
  }, [active, current])

  return (
    <GlassButtonGroup>
      <div role="tablist" aria-label="Logbook view" className="flex items-center gap-0.5">
        {VIEWS.map((v) => {
          const selected = v.value === current
          const Icon = v.icon
          return (
            <button
              key={v.value}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-label={v.label}
              title={v.label}
              onClick={() => {
                if (!selected) router.push(v.value, { scroll: false })
              }}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "bg-[var(--on-glass-active)] text-[var(--on-glass-active-fg)]"
                  : "text-foreground hover:bg-[var(--on-glass-fill-soft)]"
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </button>
          )
        })}
      </div>
    </GlassButtonGroup>
  )
}
