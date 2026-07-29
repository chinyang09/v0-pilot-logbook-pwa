"use client"

/**
 * Recycle bin — flights you deleted, for 90 days.
 *
 * Deleting a flight is one swipe and a countdown, and a logbook is a legal
 * record: "gone" should not mean gone. A deleted flight stays here, out of
 * every list and every total, until its 90 days are up
 * (`lib/utils/retention.ts`), and one tap puts it back exactly as it was.
 *
 * Each row states how long is left, because after that the flight really is
 * destroyed — the sweep runs on this page, so what you see here is what is
 * still recoverable. "Delete permanently" is offered as well, for someone who
 * wants the row gone now rather than in three months.
 */

import { useCallback, useEffect, useState } from "react"
import { Trash2, RotateCcw } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { mutate } from "swr"
import { PageContainer } from "@/components/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { SwipeableCard } from "@/components/swipeable-card"
import { FlightCardBody } from "@/components/flight-card-body"
import { usePreferences } from "@/components/providers/preferences-provider"
import { useDBReady, CACHE_KEYS } from "@/hooks/data"
import { LIST_ITEM_TRANSITION } from "@/lib/motion"
import {
  getDeletedFlights,
  restoreFlight,
  permanentlyDeleteFlight,
  purgeExpiredDeletedFlights,
  type FlightLog,
} from "@/lib/db"
import { syncService } from "@/lib/sync"
import { retentionDaysLeft, retentionLabel } from "@/lib/utils/retention"
import { cn } from "@/lib/utils"

/** "Deleted today" / "Deleted 4 days ago". */
function deletedAgo(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / (24 * 60 * 60 * 1000))
  if (days <= 0) return "Deleted today"
  if (days === 1) return "Deleted yesterday"
  return `Deleted ${days} days ago`
}

export default function RecycleBinPage() {
  const { isReady } = useDBReady()
  const { preferences } = usePreferences()
  const [flights, setFlights] = useState<FlightLog[] | null>(null)

  // Sweep the expired FIRST, then read what's left, so a flight whose window
  // has closed is never offered as restorable.
  useEffect(() => {
    if (!isReady) return
    let cancelled = false
    purgeExpiredDeletedFlights()
      .then(() => getDeletedFlights())
      .then((rows) => {
        if (!cancelled) setFlights(rows)
      })
      .catch((error) => {
        console.error("[RecycleBin] Load failed:", error)
        if (!cancelled) setFlights([])
      })
    return () => {
      cancelled = true
    }
  }, [isReady])

  const handleRestore = useCallback(
    async (flight: FlightLog) => {
      setFlights((prev) => prev?.filter((f) => f.id !== flight.id) ?? prev)
      await restoreFlight(flight.id)
      // The logbook reads a cached list; without this the restored flight only
      // shows up after a reload.
      await mutate(CACHE_KEYS.flights)
      if (navigator.onLine) syncService.fullSync()
    },
    []
  )

  const handleDeleteForever = useCallback(async (flight: FlightLog) => {
    setFlights((prev) => prev?.filter((f) => f.id !== flight.id) ?? prev)
    await permanentlyDeleteFlight(flight.id)
    if (navigator.onLine) syncService.fullSync()
  }, [])

  const isLoading = flights === null

  return (
    <PageContainer>
      <div className="px-4 pt-4 pb-safe space-y-3">
        {!isLoading && flights.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Deleted flights are kept for 90 days and count towards nothing while
            they are here. After that they are gone for good.
          </p>
        )}

        {isLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )}

        {!isLoading && (
          <AnimatePresence initial={false} mode="popLayout">
            {flights.map((flight) => {
              const deletedAt = flight.deletedAt ?? 0
              const daysLeft = retentionDaysLeft(deletedAt)
              return (
                <motion.div
                  key={flight.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={LIST_ITEM_TRANSITION}
                >
                  <SwipeableCard
                    id={`bin-${flight.id}`}
                    actions={[
                      {
                        icon: <RotateCcw className="h-5 w-5" />,
                        label: "Restore",
                        onClick: () => handleRestore(flight),
                        variant: "secondary",
                      },
                      {
                        icon: <Trash2 className="h-5 w-5" />,
                        ariaLabel: "Delete permanently",
                        onClick: () => handleDeleteForever(flight),
                        variant: "destructive",
                        holdToConfirm: true,
                        cancelLabel: "Cancel delete",
                      },
                    ]}
                  >
                    <Card className="relative border-border bg-card py-0">
                      <CardContent className="px-3 py-1">
                        {/* Muted, because this is not one of your flights any
                            more — it is a flight you can have back. */}
                        <div className="opacity-60">
                          <FlightCardBody
                            flight={flight}
                            displayPrefs={preferences.display}
                            showStatusIcons={false}
                          />
                        </div>
                        <div className="mt-1 flex items-baseline justify-between gap-2 px-0 pb-2 text-[11px]">
                          <span className="text-muted-foreground">
                            {deletedAgo(deletedAt)}
                          </span>
                          <span
                            className={cn(
                              "tabular-nums",
                              daysLeft <= 7
                                ? "text-status-warning"
                                : "text-muted-foreground/70"
                            )}
                          >
                            {retentionLabel(deletedAt)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </SwipeableCard>
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}

        {!isLoading && flights.length === 0 && (
          <EmptyState
            icon={Trash2}
            title="Nothing deleted"
            description="Flights you delete are kept here for 90 days so you can put them back."
          />
        )}
      </div>
    </PageContainer>
  )
}
