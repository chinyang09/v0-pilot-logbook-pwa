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
 *
 * MAIN / DETAIL, like every other page: tapping an item opens what it WAS —
 * its details, when it was deleted, how long it is kept — with Restore and
 * Delete forever, in the detail panel. The swipe keeps both for the quick
 * case; the panel is where you check it is the one you want back.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Trash2, RotateCcw, Plane, Users, BadgeCheck, CalendarClock } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { mutate } from "swr"
import { PageContainer } from "@/components/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { SwipeableCard } from "@/components/swipeable-card"
import { FlightCardBody } from "@/components/flight-card-body"
import { usePreferences } from "@/components/providers/preferences-provider"
import { useDBReady } from "@/hooks/data"
import { DetailFormPanel } from "@/components/ui/detail-form-panel"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { formatYMDMedium } from "@/lib/utils/date"
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
  getDeletedScheduleEntries,
  restoreScheduleEntry,
  purgeScheduleEntry,
  purgeExpiredDeletedScheduleEntries,
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
  kind: "flight" | "aircraft" | "crew" | "currency" | "duty"
  deletedAt: number
  /** What the row shows. A flight gets the shared card body; the rest are text. */
  flight?: FlightLog
  title?: string
  subtitle?: string
  /** What the detail panel lists — label, value — beyond the row. */
  details: [string, string][]
}

/** One selection for every kind: ids from different tables can collide. */
const binKey = (row: Pick<Binned, "kind" | "id">) => `${row.kind}:${row.id}`

const STAMP = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

/** Drop the empty pairs, so a panel lists only what the record holds. */
const filled = (pairs: [string, string | null | undefined][]): [string, string][] =>
  pairs.filter((p): p is [string, string] => !!p[1])

const SECTIONS = [
  { kind: "flight", label: "Flights", noun: "Flight", icon: Plane },
  { kind: "aircraft", label: "Aircraft", noun: "Aircraft", icon: Plane },
  { kind: "crew", label: "Crew", noun: "Crew member", icon: Users },
  { kind: "currency", label: "Currencies", noun: "Currency", icon: BadgeCheck },
  { kind: "duty", label: "Duties", noun: "Duty", icon: CalendarClock },
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
  // Roster duties — standby, ground, leave, off. These used to be HARD
  // deletes on the reasoning that the next report regenerates them, which
  // stopped being true once they became hand-editable.
  duty: {
    restore: restoreScheduleEntry,
    destroy: purgeScheduleEntry,
    purgeExpired: purgeExpiredDeletedScheduleEntries,
  },
}

async function loadBinned(): Promise<Binned[]> {
  const [flights, aircraft, crew, currencies, duties] = await Promise.all([
    getDeletedFlights(),
    getDeletedAircraftReferences(),
    getDeletedPersonnel(),
    getDeletedCurrency(),
    getDeletedScheduleEntries(),
  ])

  return [
    ...flights.map((f): Binned => ({
      id: f.id,
      kind: "flight",
      deletedAt: f.deletedAt ?? 0,
      flight: f,
      title: f.flightNumber || "Flight",
      // The flight card says it all — date, times, route, aircraft, crew.
      details: [],
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
        details: filled([
          ["Registration", a.registration],
          ["Type", ac?.typecode],
          ["Operator", ac?.operator],
        ]),
      };
    }),
    ...crew.map((c): Binned => ({
      id: c.id,
      kind: "crew",
      deletedAt: c.deletedAt ?? 0,
      title: c.name || "Crew member",
      subtitle: [c.crewId, c.roles?.join(", ")].filter(Boolean).join(" · "),
      details: filled([
        ["Name", c.name],
        ["Crew ID", c.crewId],
        ["Roles", c.roles?.join(", ")],
      ]),
    })),
    ...currencies.map((c): Binned => ({
      id: c.id,
      kind: "currency",
      deletedAt: c.deletedAt ?? 0,
      title: c.description || c.code || "Currency",
      subtitle: c.expiryDate ? `Expires ${c.expiryDate}` : undefined,
      details: filled([
        ["Name", c.description],
        ["Code", c.code],
        ["Expires", c.expiryDate ? formatYMDMedium(c.expiryDate) : null],
      ]),
    })),
    ...duties.map((d): Binned => ({
      id: d.id,
      kind: "duty",
      deletedAt: d.deletedAt ?? 0,
      title: d.dutyCode || d.dutyType,
      subtitle: [
        d.date,
        d.reportTime && d.debriefTime ? `${d.reportTime} – ${d.debriefTime}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      details: filled([
        ["Code", d.dutyCode],
        ["Type", d.dutyType],
        ["Date", d.date ? formatYMDMedium(d.date) : null],
        ["Window (UTC)", d.reportTime && d.debriefTime ? `${d.reportTime} – ${d.debriefTime}` : null],
      ]),
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

  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const selected = useMemo(
    () => (selectedId ? rows?.find((r) => binKey(r) === selectedId) ?? null : null),
    [rows, selectedId]
  )
  const openRow = useCallback((row: Binned) => setSelectedId(binKey(row)), [setSelectedId])

  // Restoring or destroying the open item closes its panel along with the row.
  const restoreSelected = useCallback(
    async (row: Binned) => {
      setSelectedId(null)
      await handleRestore(row)
    },
    [handleRestore, setSelectedId]
  )
  const destroySelected = useCallback(
    async (row: Binned) => {
      setSelectedId(null)
      await handleDeleteForever(row)
    },
    [handleDeleteForever, setSelectedId]
  )

  useEffect(() => {
    setDetailContent(
      selected ? (
        <DetailFormPanel
          key={binKey(selected)}
          title={selected.title || "Deleted item"}
          dirty={false}
          canSave={false}
          saving={false}
          onSave={() => {}}
          onCancel={() => {}}
        >
          {selected.flight && (
            <div className="rounded-xl border bg-card px-3 py-1 opacity-60">
              <FlightCardBody
                flight={selected.flight}
                displayPrefs={preferences.display}
                showStatusIcons={false}
              />
            </div>
          )}
          {selected.details.length > 0 && (
            <FormSection title={SECTIONS.find((s) => s.kind === selected.kind)?.noun ?? "Item"}>
              {selected.details.map(([label, value]) => (
                <ReadOnlyRow key={label} label={label} value={value} />
              ))}
            </FormSection>
          )}
          <FormSection title="Deleted">
            <ReadOnlyRow label="On" value={STAMP.format(new Date(selected.deletedAt))} />
            <ReadOnlyRow
              label="Kept for"
              value={retentionLabel(selected.deletedAt, Date.now(), DELETED_RETENTION_MS)}
            />
          </FormSection>
          <ActionStack>
            <ActionRow label="Restore" primary onClick={() => restoreSelected(selected)} />
            <ActionRow label="Delete forever" destructive onClick={() => destroySelected(selected)} />
          </ActionStack>
        </DetailFormPanel>
      ) : null
    )
  }, [selected, preferences.display, restoreSelected, destroySelected, setDetailContent])

  return (
    <PageContainer title="Bin">
      <div className="px-panel pt-4 space-y-3">
        {!isLoading && !isEmpty && (
          <p className="text-xs text-muted-foreground">
            Deleted items are kept for 30 days and count towards nothing while
            they are here. After that they are gone for good. Tap an item to
            see it, or swipe it left to restore it.
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
                          onClick={() => openRow(row)}
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
                          <Card
                            className={cn(
                              "relative cursor-pointer border-border bg-card py-0 transition-colors",
                              // Lit only where the panel beside the list shows it.
                              isDesktop && selectedId === binKey(row) && "bg-primary/10"
                            )}
                          >
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
                                      : "text-muted-foreground"
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
