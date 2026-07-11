"use client";

import type React from "react";

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  memo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FlightLog } from "@/lib/db";
import { deleteFlight } from "@/lib/db";
import { formatHHMMDisplay } from "@/lib/utils/time";
import { parseYMDLocal as parseDateLocal } from "@/lib/utils/date";
import { getDepartureDisplay, getArrivalDisplay } from "@/lib/utils/airport-display";
import { usePreferences } from "@/components/providers/preferences-provider";
import type { DisplayPreferences } from "@/types/db/stores.types";
import { syncService } from "@/lib/sync";
import { mutate } from "swr";
import { CACHE_KEYS } from "@/hooks/data";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plane,
  Trash2,
  Lock,
  Unlock,
  Sun,
  Moon,
  Pen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SwipeableCard } from "@/components/swipeable-card";
import { FastScroll, type FastScrollItem } from "@/components/ui/fast-scroll";

export interface FlightListRef {
  scrollToFlight: (flightId: string, instant?: boolean) => void;
}

interface FlightListProps {
  flights: FlightLog[];
  isLoading?: boolean;
  onEdit?: (flight: FlightLog) => void;
  onDeleted?: () => void;
  onTopFlightChange?: (flight: FlightLog | null) => void;
  onScrollStart?: () => void;
  onScroll?: (e: React.UIEvent<HTMLElement>) => void;
  topSpacerHeight?: number; // Height of the calendar
  headerContent?: React.ReactNode; // Height of the top bar (48px)
  selectedFlightId?: string | null; // Currently selected flight for visual highlighting
}


const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function timeToMinutes(hhmm: string): number {
  const parts = hhmm.split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function formatScheduledDuration(scheduledOut: string, scheduledIn: string): string {
  let diff = timeToMinutes(scheduledIn) - timeToMinutes(scheduledOut);
  if (diff < 0) diff += 1440;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

// Callbacks receive the flight so the parent can pass stable (useCallback)
// handlers — inline `() => …` closures would give every card new props each
// render and defeat the memo below.
interface SwipeableFlightCardProps {
  flight: FlightLog;
  onEdit: (flight: FlightLog) => void;
  onDelete: (flight: FlightLog) => void;
  onToggleLock: (flight: FlightLog) => void;
  isSelected?: boolean;
  displayPrefs?: DisplayPreferences;
}

const SwipeableFlightCard = memo(function SwipeableFlightCard({
  flight,
  onEdit,
  onDelete,
  onToggleLock,
  isSelected = false,
  displayPrefs,
}: SwipeableFlightCardProps) {
  const isLocked = flight.isLocked || false;

  const hasOut = !!flight.outTime;
  const hasIn = !!flight.inTime;
  const isScheduled = !hasOut || !hasIn;

  const displayOut = hasOut
    ? flight.outTime!.slice(0, 5)
    : flight.scheduledOut
      ? flight.scheduledOut.slice(0, 5)
      : "";
  const displayIn = hasIn
    ? flight.inTime!.slice(0, 5)
    : flight.scheduledIn
      ? flight.scheduledIn.slice(0, 5)
      : "";

  const durationInfo = useMemo(() => {
    if (hasOut && hasIn) {
      return {
        text: formatHHMMDisplay(flight.blockTime, displayPrefs?.timeFormat),
        suffix: "hrs",
        scheduled: false,
      };
    }
    if (flight.scheduledOut && flight.scheduledIn) {
      return {
        text: formatScheduledDuration(flight.scheduledOut, flight.scheduledIn),
        suffix: "sch",
        scheduled: true,
      };
    }
    return { text: "", suffix: "hrs", scheduled: false };
  }, [hasOut, hasIn, flight.blockTime, flight.scheduledOut, flight.scheduledIn, displayPrefs?.timeFormat]);

  const flightDate = parseDateLocal(flight.date);
  const day = flightDate.getDate().toString().padStart(2, "0");
  const month = MONTHS[flightDate.getMonth()];
  const year = flightDate.getFullYear().toString().slice(2);

  const totalDayLandings = flight.dayLandings || 0;
  const totalNightLandings = flight.nightLandings || 0;

  const crewNames = useMemo(() => {
    const names: string[] = [];
    if (flight.picName) names.push(flight.picName);
    if (flight.sicName) names.push(flight.sicName);
    if (flight.additionalCrew && Array.isArray(flight.additionalCrew)) {
      flight.additionalCrew.forEach((crew) => {
        if (crew.name) names.push(crew.name);
      });
    }
    return names;
  }, [flight.picName, flight.sicName, flight.additionalCrew]);

  return (
    <SwipeableCard
      onClick={() => !isLocked && onEdit(flight)}
      actions={[
        {
          icon: isLocked ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />,
          onClick: () => onToggleLock(flight),
          variant: "secondary",
        },
        {
          icon: <Trash2 className="h-5 w-5" />,
          onClick: () => onDelete(flight),
          variant: "destructive",
          holdToConfirm: true,
          disabled: isLocked,
        },
      ]}
    >
      <Card
        className={cn(
          "bg-card border-border cursor-pointer relative py-0 transition-all",
          isLocked && "opacity-75",
          isScheduled && "border-l-2 border-l-orange-600/70 dark:border-l-orange-400/70",
          isSelected && "bg-primary/20 border-primary",
          !isSelected && "hover:bg-muted/50"
        )}
      >
        <CardContent className="px-3 py-1">
          <div className={cn("flex items-start gap-2", isScheduled && "text-orange-600 dark:text-orange-400/80")}>
            <div className="flex flex-col items-center justify-start shrink-0 w-16">
              <div className="text-6xl font-bold leading-none tracking-tight">
                {day}
              </div>
              <div className={cn("text-base mt-0.5 tracking-wide", isScheduled ? "text-orange-600/70 dark:text-orange-400/60" : "text-muted-foreground")}>
                {month} {year}
              </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-1">
                  <span className={cn(
                    "text-base font-semibold leading-tight",
                    isScheduled && hasOut && "text-foreground"
                  )}>
                    {displayOut}
                  </span>
                  <div className="flex items-center gap-1 flex-1 justify-center">
                    <div className={cn("h-px flex-1", durationInfo.scheduled ? "bg-orange-600/40 dark:bg-orange-400/30" : "bg-border")} />
                    <span className="text-base font-medium whitespace-nowrap px-1">
                      {durationInfo.text}{durationInfo.text ? ` ${durationInfo.suffix}` : ""}
                    </span>
                    <div className={cn("h-px flex-1", durationInfo.scheduled ? "bg-orange-600/40 dark:bg-orange-400/30" : "bg-border")} />
                  </div>
                  <span className={cn(
                    "text-base font-semibold leading-tight",
                    isScheduled && hasIn && "text-foreground"
                  )}>
                    {displayIn}
                  </span>
                </div>

                <div className="flex items-center justify-between mt-0">
                  <span className="text-2xl font-bold leading-tight tracking-tight">
                    {getDepartureDisplay(flight, displayPrefs?.airportIdentifier)}
                  </span>
                  <span className="text-2xl font-bold leading-tight tracking-tight">
                    {getArrivalDisplay(flight, displayPrefs?.airportIdentifier)}
                  </span>
                </div>
              </div>

              <div className={cn("flex items-center gap-1.5 text-xs leading-tight mt-0.5", isScheduled ? "text-orange-600/70 dark:text-orange-400/60" : "text-muted-foreground")}>
                <span>{flight.flightNumber || ""}</span>
                <span>•</span>
                <span>{flight.aircraftReg || ""}</span>
                <span>•</span>
                <span>{flight.aircraftType || ""}</span>
              </div>

              <div className="flex items-center justify-between mt-0.5">
                <div className={cn("flex flex-1 min-w-0 text-xs leading-tight", isScheduled ? "text-orange-600/70 dark:text-orange-400/60" : "text-muted-foreground")}>
                  {crewNames.map((name, i) => (
                    <span key={`${name}-${i}`} className="flex-1 min-w-0 truncate">
                      {i > 0 ? ", " : ""}{name}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 text-xs font-medium shrink-0 ml-2">
                  {totalDayLandings > 0 && (
                    <div className="flex items-center gap-0.5">
                      <Sun className="h-3 w-3" />
                      <span>{totalDayLandings}D</span>
                    </div>
                  )}
                  {totalNightLandings > 0 && (
                    <div className="flex items-center gap-0.5">
                      <Moon className="h-3 w-3" />
                      <span>{totalNightLandings}N</span>
                    </div>
                  )}
                  {flight.signature && (
                    <Pen className="h-3 w-3 text-primary" />
                  )}
                  {isLocked && (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </SwipeableCard>
  );
});

// Generate FastScroll items from flight dates (year-based navigation)
function generateFlightYearItems(flights: FlightLog[]): FastScrollItem[] {
  if (flights.length === 0) return [];

  const years = new Map<string, number>();

  flights.forEach((flight, index) => {
    const date = parseDateLocal(flight.date);
    const year = date.getFullYear().toString();

    if (!years.has(year)) {
      years.set(year, index);
    }
  });

  // Sort years in descending order (newest first)
  const sorted = Array.from(years.keys()).sort((a, b) => b.localeCompare(a));

  return sorted.map((year) => ({
    key: year,
    label: year.slice(-2), // Show last 2 digits (e.g., "24" for 2024)
  }));
}

// Get first flight index for a given year
function getFirstFlightIndexForYear(flights: FlightLog[], targetYear: string): number {
  const year = parseInt(targetYear, 10);

  for (let i = 0; i < flights.length; i++) {
    const date = parseDateLocal(flights[i].date);
    if (date.getFullYear() === year) {
      return i;
    }
  }

  return -1;
}

export const FlightList = forwardRef<FlightListRef, FlightListProps>(
  function FlightList(
    {
      flights,
      isLoading,
      onEdit,
      onDeleted,
      onTopFlightChange,
      onScrollStart,
      onScroll,
      topSpacerHeight = 0,
      headerContent,
      selectedFlightId,
    },
    ref
  ) {
    const { preferences } = usePreferences();

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isExternalScrollRef = useRef(false);
    const lastDetectedFlightRef = useRef<string | null>(null);
    const [activeYearKey, setActiveYearKey] = useState<string | undefined>(undefined);
    const isFastScrollingRef = useRef(false);
    // Tracks the card currently being deleted + its measured height.
    // Cards below use a CSS translateY(-height) transition to shift up smoothly
    // without touching the virtualizer's ResizeObserver measurements (which would
    // cause the index-stale-size bug that makes cards B and C overlap).
    const [deletingInfo, setDeletingInfo] = useState<{ id: string; height: number } | null>(null);

    // Generate FastScroll items from flights (year-based)
    const fastScrollItems = useMemo(() => generateFlightYearItems(flights), [flights]);

    // Create virtualizer instance
    const rowVirtualizer = useVirtualizer({
      count: flights.length,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: () => 104, // Measured: 86px content + 8px py-1 + 2px border + 8px container padding
      overscan: 5, // Render 5 extra items above/below viewport
    });

    // Get virtual items
    const virtualItems = rowVirtualizer.getVirtualItems();

    useImperativeHandle(
      ref,
      () => ({
        scrollToFlight: (flightId: string, instant?: boolean) => {
          const index = flights.findIndex((f) => f.id === flightId);
          if (index !== -1) {
            isExternalScrollRef.current = true;

            if (instant) {
              rowVirtualizer.scrollToIndex(index, { align: "start", behavior: "auto" });
              setTimeout(() => {
                isExternalScrollRef.current = false;
                scrollContainerRef.current?.dispatchEvent(new Event('scroll'));
              }, 100);
              return;
            }

            const container = scrollContainerRef.current;
            if (!container) return;

            // Capture current position, instant-jump to target, capture target, reset
            const startOffset = container.scrollTop;
            rowVirtualizer.scrollToIndex(index, { align: "start", behavior: "auto" });
            const targetOffset = container.scrollTop;
            container.scrollTop = startOffset;

            // Animate smoothly over fixed 300ms with ease-out cubic
            const duration = 300;
            const startTime = performance.now();
            const distance = targetOffset - startOffset;

            if (Math.abs(distance) < 1) {
              isExternalScrollRef.current = false;
              return;
            }

            const animate = (currentTime: number) => {
              const elapsed = currentTime - startTime;
              const progress = Math.min(elapsed / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              container.scrollTop = startOffset + distance * eased;

              if (progress < 1) {
                requestAnimationFrame(animate);
              } else {
                isExternalScrollRef.current = false;
                container.dispatchEvent(new Event('scroll'));
              }
            };

            requestAnimationFrame(animate);
          }
        },
      }),
      [flights, rowVirtualizer]
    );

    const handleScroll = useCallback(() => {
      if (isExternalScrollRef.current) return;
      // Note: onScrollStart is now triggered by touch events, not scroll events
      // This prevents programmatic/momentum scrolls from changing the sync source

      if (flights.length === 0) return;

      const visibleItems = rowVirtualizer.getVirtualItems();
      if (visibleItems.length === 0) return;

      // Get the scroll offset from the virtualizer
      const scrollOffset = rowVirtualizer.scrollOffset ?? 0;

      // Find the first item that is actually visible at the top of the viewport.
      // getVirtualItems() includes overscan items rendered above/below the viewport.
      // Overscan items above have item.end <= scrollOffset.
      // The first visible item is the first one where item.end > scrollOffset.
      let topVisibleItem = visibleItems[0];
      for (const item of visibleItems) {
        if (item.end > scrollOffset) {
          topVisibleItem = item;
          break;
        }
      }

      const topFlight = flights[topVisibleItem.index];

      if (topFlight) {
        // Update active year for FastScroll (use ref to avoid stale closure)
        if (!isFastScrollingRef.current) {
          const date = parseDateLocal(topFlight.date);
          const newYearKey = date.getFullYear().toString();
          setActiveYearKey(newYearKey);
        }

        if (topFlight.id !== lastDetectedFlightRef.current) {
          lastDetectedFlightRef.current = topFlight.id;
          onTopFlightChange?.(topFlight);
        }
      }
    }, [flights, onTopFlightChange, rowVirtualizer]);

    // Handle user touch/interaction/wheel start on flight list
    const handleTouchStart = useCallback(() => {
      if (!isExternalScrollRef.current) {
        onScrollStart?.();
      }
    }, [onScrollStart]);

    const handleWheelStart = useCallback(() => {
      if (!isExternalScrollRef.current) {
        onScrollStart?.();
      }
    }, [onScrollStart]);

    useEffect(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      let ticking = false;
      const scrollHandler = (e: Event) => {
        // Call external onScroll for navbar hiding (on every scroll event)
        if (onScroll) {
          onScroll(e as unknown as React.UIEvent<HTMLElement>);
        }

        // Throttle bidirectional sync logic with RAF
        if (!ticking) {
          requestAnimationFrame(() => {
            handleScroll();
            ticking = false;
          });
          ticking = true;
        }
      };

      container.addEventListener("scroll", scrollHandler, { passive: true });

      return () => {
        container.removeEventListener("scroll", scrollHandler);
      };
    }, [handleScroll, onScroll]);

    const handleEdit = useCallback(
      (flight: FlightLog) => onEdit?.(flight),
      [onEdit]
    );

    const performDelete = useCallback(async (flight: FlightLog) => {
      // Measure the card's current rendered height from the outer wrapper div.
      // This height is used to shift cards below upward by the exact right amount.
      const outerEl = document.getElementById(`flight-${flight.id}`);
      const height = outerEl?.getBoundingClientRect().height ?? 104;

      // Declaratively trigger two simultaneous CSS animations:
      // 1. The deleting card fades + slides left (matched by isDeleting below).
      // 2. Cards below shift up by `height` px (matched by isBelow below).
      // The virtualizer's ResizeObserver is never involved — no measured heights
      // change — so sizesRef[N] stays correct and the B/C overlap bug cannot occur.
      setDeletingInfo({ id: flight.id, height });

      // Wait for CSS transitions to complete (longest is 200ms shift-up).
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear animation state and remove from SWR cache. React 18 batches these
      // into a single render: deletingIndex becomes -1 → isBelow becomes false for
      // all cards → shift divs remove their translateY(-height). At the same time
      // the virtualizer recalculates new_start[B] = old_start[B] - height.
      // Net position: translateY(new_start) + translateY(0) = translateY(old_start - height).
      // This is exactly where the CSS animation left the cards → no jump.
      setDeletingInfo(null);
      mutate(
        CACHE_KEYS.flights,
        (prev: FlightLog[] | undefined) => prev?.filter((f) => f.id !== flight.id),
        { revalidate: false }
      );
      await deleteFlight(flight.id);
      if (navigator.onLine) syncService.fullSync();
      onDeleted?.();
    }, [onDeleted]);

    const handleToggleLock = useCallback(async (flight: FlightLog) => {
      const { updateFlight } = await import("@/lib/db");
      // Optimistic: flip lock state in SWR cache immediately.
      mutate(
        CACHE_KEYS.flights,
        (prev: FlightLog[] | undefined) =>
          prev?.map((f) => (f.id === flight.id ? { ...f, isLocked: !f.isLocked } : f)),
        { revalidate: false }
      );
      await updateFlight(flight.id, { isLocked: !flight.isLocked });
      onDeleted?.();
    }, [onDeleted]);

    // FastScroll selection handler (year-based) with instant scrolling
    const handleFastScrollSelect = useCallback(
      (year: string) => {
        const index = getFirstFlightIndexForYear(flights, year);
        if (index !== -1) {
          isExternalScrollRef.current = true;
          isFastScrollingRef.current = true;
          setActiveYearKey(year);
          rowVirtualizer.scrollToIndex(index, {
            align: "start",
            behavior: "auto", // Use "auto" for instant scroll during fast scroll
          });

          // Notify parent for calendar sync
          onScrollStart?.();
          onTopFlightChange?.(flights[index]);

          setTimeout(() => {
            isExternalScrollRef.current = false;
          }, 100);
        }
      },
      [flights, rowVirtualizer, onScrollStart, onTopFlightChange]
    );

    const handleFastScrollStart = useCallback(() => {
      isFastScrollingRef.current = true;
    }, []);

    const handleFastScrollEnd = useCallback(() => {
      // Delay resetting to allow final scroll position to settle
      setTimeout(() => {
        isFastScrollingRef.current = false;
      }, 100);
    }, []);

    if (isLoading) {
      return (
        <div className="h-full overflow-y-auto p-2 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="bg-card border-border">
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-12" />
                    <Skeleton className="h-px w-20" />
                    <Skeleton className="h-6 w-12" />
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    if (flights.length === 0) {
      return (
        <>
          <div
            ref={scrollContainerRef}
            className="h-full overflow-y-auto overscroll-contain"
            onTouchStart={handleTouchStart}
            onMouseDown={handleTouchStart}
            onWheel={handleWheelStart}
          >
            <div
              style={{ height: `${topSpacerHeight}px` }}
              className="transition-[height] duration-300 ease-in-out"
            />
            {headerContent}
            <div className="px-2 pt-2">
              <EmptyState
                icon={Plane}
                title="No flights logged"
                description="Add your first flight to get started"
              />
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="relative h-full flex">
          {/* Main scrollable container */}
          <div
            ref={scrollContainerRef}
            className="h-full overflow-y-auto flex-1 overscroll-contain"
            style={{ contain: "strict" }}
            onTouchStart={handleTouchStart}
            onMouseDown={handleTouchStart}
            onWheel={handleWheelStart}
          >
            {/* Top spacer for calendar */}
            <div
              style={{ height: `${topSpacerHeight}px` }}
              className="transition-[height] duration-300 ease-in-out"
            />

            {headerContent}

            {/* Virtual list container */}
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {(() => {
                // Index of the card currently animating out. Computed once here
                // (not inside the map) to avoid redundant findIndex calls per item.
                const deletingIndex = deletingInfo
                  ? flights.findIndex((f) => f.id === deletingInfo.id)
                  : -1;
                return virtualItems.map((virtualRow) => {
                  const flight = flights[virtualRow.index];
                  const isDeleting = deletingInfo?.id === flight.id;
                  // Cards strictly below the deleting card shift upward via CSS.
                  const isBelow = deletingIndex !== -1 && virtualRow.index > deletingIndex;
                  return (
                    <div
                      key={flight.id}
                      id={`flight-${flight.id}`}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                    >
                      {/* Shift div: slides cards below the deleting card upward
                          using a CSS translateY transition. This keeps the
                          virtualizer's ResizeObserver measurements untouched —
                          only layout height changes trigger remeasure, not CSS
                          transforms. Avoids the stale sizesRef[N]=0 overlap bug. */}
                      <div
                        style={isBelow ? {
                          transform: `translateY(-${deletingInfo!.height}px)`,
                          transition: "transform 200ms ease-out",
                        } : undefined}
                      >
                        {/* Content wrapper: padding + fade-out for the deleting card */}
                        <div
                          style={{
                            padding: "0 8px 8px 8px",
                            ...(isDeleting && {
                              opacity: 0,
                              transform: "translateX(-40px)",
                              transition: "opacity 150ms ease-out, transform 150ms ease-out",
                              pointerEvents: "none",
                            }),
                          }}
                        >
                          <SwipeableFlightCard
                            flight={flight}
                            onEdit={handleEdit}
                            onDelete={performDelete}
                            onToggleLock={handleToggleLock}
                            isSelected={selectedFlightId === flight.id}
                            displayPrefs={preferences.display}
                          />
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Bottom padding */}
            <div className="h-16" />
          </div>

          {/* FastScroll rail (year-based navigation) - positioned in visible area below calendar/header */}
          {fastScrollItems.length > 1 && (
            <div
              className="absolute right-0 bottom-0 z-40 flex items-center pointer-events-none transition-[top] duration-300 ease-in-out"
              style={{ top: `${topSpacerHeight}px` }}
            >
              <div className="pointer-events-auto">
                <FastScroll
                  items={fastScrollItems}
                  activeKey={activeYearKey}
                  onSelect={handleFastScrollSelect}
                  onScrollStart={handleFastScrollStart}
                  onScrollEnd={handleFastScrollEnd}
                  indicatorPosition="left"
                  className="py-8"
                />
              </div>
            </div>
          )}
        </div>
      </>
    );
  }
);
