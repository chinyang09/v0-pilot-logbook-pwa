"use client"

/**
 * Recently Deleted — everything you deleted, for 30 days.
 *
 * Deleting is now one tap with no countdown, so "gone" has to mean "gone from
 * the lists", not "destroyed". Every delete in the app is a SOFT delete: the
 * row drops out of every list, every total and every import match, and lands
 * here until its 30 days are up (`DELETED_RETENTION_MS`). One tap puts it back
 * exactly as it was.
 *
 * That is the trade the countdown used to make, moved to a better place. A
 * timed arm asked you to wait ten seconds every time you deleted something on
 * purpose, and gave you nothing at all once the ten seconds had passed. A
 * holding area costs nothing on the way out and is still there tomorrow.
 *
 * Rows are grouped by WHAT they are, because the four kinds are not
 * interchangeable — you come here looking for a flight, or for the aircraft
 * you removed by accident, and a single mixed list makes you read all of it.
 * Each row states how long it has left, because after that it really is
 * destroyed: the sweep runs on load, so what you can see here is exactly what
 * is still recoverable.
 */

import { useCallback, useEffect, useState } from "react"
import { Trash2, RotateCcw, Plane, Users, BadgeCheck } from "lucide-react"
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
  getDeletedPersonnel,
  restorePersonnel,
  permanentlyDeletePersonnel,
  purgeExpiredDeletedPersonnel,
  getDeletedCurrency,
  restoreCurrency,
  permanentlyDeleteCurrency,
  purgeExpiredDeletedCurrency,
  getDeletedAircraftReferences,
  restoreAircraftInDatabase,
  permanentlyDeleteAircraftFromDatabase,
  purgeExpiredDeletedAircraftReferences,
  normalizeAircraft,
  type FlightLog,
} from "@/lib/db"
import { syncService } from "@/lib/sync"
import {
  DELETED_RETENTION_MS,
  retentionDaysLeft,
  retentionLabel,
} from "@/lib/utils/retention"
import { cn } from "@/lib/utils"

/** "Deleted today" / "Deleted 4 days ago". */
function deletedAgo(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / (24 * 60 * 60 * 1000))
  if (days <= 0) return "Deleted today"
  if (days === 1) return "Deleted yesterday"
  return `Deleted ${days} days ago`
}

/** One deleted thing, flattened so the page can treat all four the same. */
type Binned = {
  id: string
  kind: "flight" | "aircraft" | "crew" | "currency"
  deletedAt: number
  /** What the row shows. A flight gets the shared card body; the rest are text. */
  flight?: FlightLog
  title?: string
  subtitle?: string
}

const SECTIONS = [
  { kind: "flight", label: "Flights", icon: Plane },
  { kind: "aircraft", label: "Aircraft", icon: Plane },
  { kind: "crew", label: "Crew", icon: Users },
  { kind: "currency", label: "Currencies", icon: BadgeCheck },
] as const

/**
 * Restore / destroy, per kind.
 *
 * A lookup rather than a switch at each call site: the page has three places
 * that need "do the right thing for this row" (restore, delete forever, and the
 * load sweep), and a switch in each is where the four kinds drift apart.
 */
const OPS: Record<
  Binned["kind"],
  {
    restore: (id: string) => Promise<unknown>
    destroy: (id: string) => Promise<unknown>
    purgeExpired: () => Promise<unknown>
  }
> = {
  flight: {
    restore: restoreFlight,
    destroy: permanentlyDeleteFlight,
    purgeExpired: purgeExpiredDeletedFlights,
  },
  // The aircraft LIST is the reference database, not the user `aircraft`
  // table — that is what the aircraft page deletes from. It has no sync queue,
  // so this pair is local to the device, which is what deleting a custom
  // aircraft has always meant.
  aircraft: {
    restore: restoreAircraftInDatabase,
    destroy: permanentlyDeleteAircraftFromDatabase,
    purgeExpired: purgeExpiredDeletedAircraftReferences,
  },
  crew: {
    restore: restorePersonnel,
    destroy: permanentlyDeletePersonnel,
    purgeExpired: purgeExpiredDeletedPersonnel,
  },
  currency: {
    restore: restoreCurrency,
    destroy: permanentlyDeleteCurrency,
    purgeExpired: purgeExpiredDeletedCurrency,
  },
}

async function loadBinned(): Promise<Binned[]> {
  const [flights, aircraft, crew, currencies] = await Promise.all([
    getDeletedFlights(),
    getDeletedAircraftReferences(),
    getDeletedPersonnel(),
    getDeletedCurrency(),
  ])

  return [
    ...flights.map((f): Binned => ({
      id: f.id,
      kind: "flight",
      deletedAt: f.deletedAt ?? 0,
      flight: f,
    })),
    ...aircraft.map((a): Binned => {
      // The reference row stores its detail as a JSON blob; `normalizeAircraft`
      // is the one place that knows how to read it.
      const ac = (() => {
        try {
          return normalizeAircraft(JSON.parse(a.data));
        } catch {
          return null;
        }
      })();
      return {
        // Keyed by registration — the reference table's primary key.
        id: a.registration,
        kind: "aircraft",
        deletedAt: a.deletedAt ?? 0,
        title: a.registration || "Aircraft",
        subtitle: [ac?.typecode, ac?.operator].filter(Boolean).join(" · "),
      };
    }),
    ...crew.map((c): Binned => ({
      id: c.id,
      kind: "crew",
      deletedAt: c.deletedAt ?? 0,
      title: c.name || "Crew member",
      subtitle: [c.crewId, c.roles?.join(", ")].filter(Boolean).join(" · "),
    })),
    ...currencies.map((c): Binned => ({
      id: c.id,
      kind: "currency",
      deletedAt: c.deletedAt ?? 0,
      title: c.description || c.code || "Currency",
      subtitle: c.expiryDate ? `Expires ${c.expiryDate}` : undefined,
    })),
  ]
}

export default function RecentlyDeletedPage() {
  const { isReady } = useDBReady()
  const { preferences } = usePreferences()
  const [rows, setRows] = useState<Binned[] | null>(null)

  // Sweep the expired FIRST, then read what's left, so a row whose window has
  // closed is never offered as restorable.
  useEffect(() => {
    if (!isReady) return
    let cancelled = false
    Promise.all(Object.values(OPS).map((op) => op.purgeExpired()))
      .then(() => loadBinned())
      .then((loaded) => {
        if (!cancelled) setRows(loaded)
      })
      .catch((error) => {
        console.error("[RecentlyDeleted] Load failed:", error)
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [isReady])

  const drop = useCallback((row: Binned) => {
    setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? prev)
  }, [])

  const handleRestore = useCallback(
    async (row: Binned) => {
      drop(row)
      await OPS[row.kind].restore(row.id)
      // Every list reads a cached copy; without this the restored row only
      // reappears after a reload.
      await mutate((key) => typeof key === "string" && key.startsWith("idb:"))
      if (navigator.onLine) syncService.fullSync()
    },
    [drop]
  )

  const handleDeleteForever = useCallback(
    async (row: Binned) => {
      drop(row)
      await OPS[row.kind].destroy(row.id)
      if (navigator.onLine) syncService.fullSync()
    },
    [drop]
  )

  const isLoading = rows === null
  const isEmpty = !isLoading && rows.length === 0

  return (
    <PageContainer>
      <div className="px-panel pt-4 space-y-3">
        {!isLoading && !isEmpty && (
          <p className="text-xs text-muted-foreground">
            Deleted items are kept for 30 days and count towards nothing while
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

        {!isLoading &&
          SECTIONS.map(({ kind, label }) => {
            const section = rows.filter((r) => r.kind === kind)
            if (section.length === 0) return null
            return (
              <section key={kind} className="space-y-2 pt-1">
                <h2 className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {label}
                </h2>
                <AnimatePresence initial={false} mode="popLayout">
                  {section.map((row) => {
                    const daysLeft = retentionDaysLeft(
                      row.deletedAt,
                      Date.now(),
                      DELETED_RETENTION_MS
                    )
                    return (
                      <motion.div
                        key={row.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={LIST_ITEM_TRANSITION}
                      >
                        <SwipeableCard
                          id={`bin-${row.id}`}
                          actions={[
                            {
                              icon: <RotateCcw className="h-5 w-5" />,
                              label: "Restore",
                              onClick: () => handleRestore(row),
                              variant: "secondary",
                            },
                            {
                              icon: <Trash2 className="h-5 w-5" />,
                              ariaLabel: "Delete permanently",
                              onClick: () => handleDeleteForever(row),
                              variant: "destructive",
                            },
                          ]}
                        >
                          <Card className="relative border-border bg-card py-0">
                            <CardContent className="px-3 py-1">
                              {/* Muted, because this is not one of your records
                                  any more — it is one you can have back. */}
                              <div className="opacity-60">
                                {row.flight ? (
                                  <FlightCardBody
                                    flight={row.flight}
                                    displayPrefs={preferences.display}
                                    showStatusIcons={false}
                                  />
                                ) : (
                                  <div className="py-2">
                                    <div className="text-sm font-medium text-foreground">
                                      {row.title}
                                    </div>
                                    {/* Reserves its line whether or not there
                                        is a subtitle, so rows in a section are
                                        all the same height. */}
                                    <div className="min-h-[1.25em] text-xs leading-tight text-muted-foreground">
                                      {row.subtitle}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="mt-1 flex items-baseline justify-between gap-2 px-0 pb-2 text-[11px]">
                                <span className="text-muted-foreground">
                                  {deletedAgo(row.deletedAt)}
                                </span>
                                <span
                                  className={cn(
                                    "tabular-nums",
                                    daysLeft <= 3
                                      ? "text-status-warning"
                                      : "text-muted-foreground/70"
                                  )}
                                >
                                  {retentionLabel(
                                    row.deletedAt,
                                    Date.now(),
                                    DELETED_RETENTION_MS
                                  )}
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        </SwipeableCard>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </section>
            )
          })}

        {isEmpty && (
          <EmptyState
            icon={Trash2}
            title="Nothing deleted"
            description="Anything you delete is kept here for 30 days so you can put it back."
          />
        )}
      </div>
    </PageContainer>
  )
}
