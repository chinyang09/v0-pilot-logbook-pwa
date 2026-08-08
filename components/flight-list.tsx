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
import { FlightCardBody } from "@/components/flight-card-body";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plane,
  Trash2,
  MoreHorizontal,
  Sun,
  Moon,
  Pen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SwipeableCard } from "@/components/swipeable-card";
import { primeFlightCache } from "@/components/flight-form";
import { FastScroll, type FastScrollItem } from "@/components/ui/fast-scroll";
import { ScrollIndicator } from "@/components/ui/scroll-indicator";
import {
  FlightQuickActions,
  type FlightQuickAction,
  type QuickActionAnchor,
} from "@/components/flight-quick-actions";
import {
  FlightContextPreview,
  type PreviewAnchor,
} from "@/components/flight-context-preview";
import { deriveFlight, type DeriveKind } from "@/lib/utils/derive-flight";
import { insertFlightSorted } from "@/lib/utils/flight-sort";

export interface FlightListRef {
  scrollToFlight: (flightId: string, instant?: boolean) => void;
  /**
   * Absorb a change in the top spacer's height without the rows appearing to
   * move.
   *
   * The list deliberately has `overflow-anchor: none` — growing the spacer is
   * how the floating panels PUSH the list, and scroll anchoring exists to
   * cancel exactly that. But the spacer also changes for reasons that are not
   * a push: switching the calendar between one month and two makes its grid a
   * different height while it is already open, and with anchoring off that
   * silently slid the whole list under the reader's eye. So the push stays
   * uncompensated and this is called for the resize.
   */
  absorbSpacerDelta: (delta: number) => void;
}

interface FlightListProps {
  flights: FlightLog[];
  isLoading?: boolean;
  onEdit?: (flight: FlightLog) => void;
  onDeleted?: () => void;
  onTopFlightChange?: (flight: FlightLog | null) => void;
  onScrollStart?: () => void;
  onScroll?: (e: React.UIEvent<HTMLElement>) => void;
  /** CSS length: the header offset plus whatever floats above the list. */
  topSpacerHeight?: string;
  /** CSS transition for the spacer, so it moves in lock-step with whatever is
   *  growing above it (the calendar) instead of on its own separate curve. */
  topSpacerTransition?: string;
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

/** How long after a dismissal an open request is treated as the same tap. */
const CASCADE_REOPEN_GUARD_MS = 350;

/** Press-and-hold before the context preview opens. Long enough not to be
 *  mistaken for a tap, short enough to feel deliberate. */
const HOLD_MS = 450;
/** Movement that cancels the hold — a scroll, or the start of a swipe. */
const HOLD_SLOP = 8;

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
  onMore: (flight: FlightLog, at: QuickActionAnchor) => void;
  onHold: (flight: FlightLog, at: PreviewAnchor) => void;
  isSelected?: boolean;
  displayPrefs?: DisplayPreferences;
}

const SwipeableFlightCard = memo(function SwipeableFlightCard({
  flight,
  onEdit,
  onDelete,
  onMore,
  onHold,
  isSelected = false,
  displayPrefs,
}: SwipeableFlightCardProps) {
  const isLocked = flight.isLocked || false;
  const isScheduled = !flight.outTime || !flight.inTime;

  // Press-and-hold opens the context preview. Cancelled by any movement past a
  // few px, so it never fires on a scroll or on the start of a swipe — those
  // own the card's other gestures.
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFromRef = useRef<{ x: number; y: number } | null>(null);
  const cancelHold = useCallback(() => {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = null;
    holdFromRef.current = null;
  }, []);
  useEffect(() => cancelHold, [cancelHold]);

  return (
    <SwipeableCard
      onPointerDown={(e) => {
        cancelHold();
        holdFromRef.current = { x: e.clientX, y: e.clientY };
        const card = e.currentTarget.getBoundingClientRect();
        const box = { left: card.left, top: card.top, width: card.width, height: card.height };
        // Carried onto the synthetic cancel below — a PointerEvent built
        // without them reports (0, 0), and framer reads the point off the
        // event it ends on.
        const { pointerId, pointerType, clientX, clientY } = e;
        holdRef.current = setTimeout(() => {
          holdRef.current = null;
          // END THIS CARD'S POINTER SESSION before the preview opens. framer
          // registers its window pointermove/pointerup listeners on
          // pointerdown; the overlay then takes the lift, so framer would
          // never see the gesture finish and the session would stay live —
          // that is the ghost swipe this cost us last time. `pointercancel` is
          // what this genuinely is: the press stopped being a drag.
          window.dispatchEvent(
            new PointerEvent("pointercancel", {
              pointerId,
              pointerType,
              clientX,
              clientY,
              bubbles: true,
            })
          );
          onHold(flight, box);
        }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        const from = holdFromRef.current;
        if (!from) return;
        if (Math.abs(e.clientX - from.x) > HOLD_SLOP || Math.abs(e.clientY - from.y) > HOLD_SLOP) {
          cancelHold();
        }
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      // Stable across the virtualiser recycling this row, so an armed delete
      // keeps its overlay while the list scrolls.
      id={`flight-${flight.id}`}
      onClick={() => {
        if (isLocked) return;
        // Hand the panel its data before it mounts — see primeFlightCache.
        primeFlightCache(flight);
        onEdit(flight);
      }}
      actions={[
        {
          // `…` opens the rest of the card's actions as their own buttons,
          // cascading out of this one — see FlightQuickActions. `keepOpen`
          // because the row they belong to should stay put beneath them.
          icon: <MoreHorizontal className="h-5 w-5" />,
          ariaLabel: "More actions",
          onClick: (rect) => {
            if (!rect) return;
            onMore(flight, {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            });
          },
          keepOpen: true,
          // See `fireOnPointerUp` — the click after a swipe was being eaten on
          // device, which cost the first tap every time.
          fireOnPointerUp: true,
          variant: "secondary",
        },
        {
          icon: <Trash2 className="h-5 w-5" />,
          onClick: () => onDelete(flight),
          variant: "destructive",
          holdToConfirm: true,
          cancelLabel: "Cancel delete",
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
          <FlightCardBody flight={flight} displayPrefs={displayPrefs} />
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
      topSpacerHeight = "0px",
      topSpacerTransition,
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

    // The row height, calibrated from the first card actually laid out.
    //
    // This matters more than it looks. When a measured row turns out taller or
    // shorter than the estimate, the virtualizer keeps the view stable by
    // programmatically scrolling by the difference — and a programmatic scroll
    // CANCELS an in-progress momentum scroll on touch. Scrolling up through
    // rows that had never been measured (after jumping into the middle of the
    // list) therefore killed the fling on almost every row: the list stopped
    // dead and needed another swipe, over and over.
    //
    // Every flight card is the same height by construction (the two optional
    // rows in flight-card-body reserve their line), so ONE measurement is the
    // right answer for all of them. Calibrate from it and the correction never
    // fires. 104 is only the opening guess, used for the first paint.
    const [rowHeight, setRowHeight] = useState(0); // 0 = not calibrated yet
    const rowHeightRef = useRef(104); // opening guess, for the first paint only
    const calibratedRef = useRef(false);

    // Create virtualizer instance
    const rowVirtualizer = useVirtualizer({
      count: flights.length,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: () => rowHeightRef.current,
      // Enough that a fast flick doesn't outrun the rendered window. Cheap now
      // that the rows aren't measured individually.
      overscan: 8,
      // Sizes are keyed per FLIGHT, not per index. Keyed by index they get
      // misattributed the moment the list changes — a delete or a re-sort
      // hands row N the height that belonged to whatever used to be there.
      getItemKey: (index) => flights[index]?.id ?? `row-${index}`,
    });

    // Calibrate ONCE off the first card that lays out, then never measure again.
    //
    // Not measuring is the point. Every card is the same height by
    // construction, so one number is exact for all of them — and with no
    // per-row measurement the virtualizer can never discover a size it didn't
    // expect, which means it can never correct the scroll offset. That is what
    // makes the momentum scroll survive anywhere in the list, including
    // upwards through rows that have never been on screen.
    //
    // It is also strictly one-shot on purpose. Feeding every row's measurement
    // back into the estimate is a setState in a ref callback: two rows that
    // disagree by a fraction of a pixel (subpixel layout, a device's font
    // scaling) ping-pong it and React tears the page down with "maximum update
    // depth exceeded".
    const measureRow = useCallback((el: HTMLElement | null) => {
      if (!el || calibratedRef.current) return;
      const h = Math.round(el.getBoundingClientRect().height);
      if (h <= 0) return;
      calibratedRef.current = true;
      rowHeightRef.current = h;
      setRowHeight(h);
    }, []);

    // Rebuild every row's position from the calibrated height. `estimateSize`
    // is read through a ref, which the virtualizer does not watch — this is
    // what tells it to look again.
    useEffect(() => {
      if (rowHeight > 0) rowVirtualizer.measure();
    }, [rowHeight, rowVirtualizer]);

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
        absorbSpacerDelta: (delta: number) => {
          const container = scrollContainerRef.current;
          if (!container || !delta) return;
          // At the very top there is nothing to absorb — the rows are already
          // against the spacer, so shifting scrollTop would scroll the list
          // away from the top instead of holding it still.
          if (container.scrollTop <= 0) return;
          container.scrollTop += delta;
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

    // ─── The `…` cascade ───
    // Opened from the swipe panel's own `…` button, and anchored to it, so the
    // run of extra actions comes out of the control that asked for them. The
    // swipe panel deliberately stays OPEN underneath (`keepOpen`).
    const [held, setHeld] = useState<{ flight: FlightLog; at: QuickActionAnchor } | null>(null);
    // When the cascade is dismissed by a tap on the `…` itself, the two halves
    // of that tap can land on either side of the unmount: the capture-phase
    // swallow closes it on `pointerup`, React tears the listeners down, and the
    // `click` that follows is no longer swallowed — so it reaches the button
    // and reopens. Chromium/Android orders it that way; WebKit did not, which
    // is why it looked like a platform bug. A close STAMP settles it either
    // way: an open request arriving in the wake of a close is that same tap.
    const closedAtRef = useRef(0);
    const closeCascade = useCallback(() => {
      closedAtRef.current = Date.now();
      setHeld(null);
    }, []);
    // ─── The press-and-hold context preview ───
    // A different thing from the `…` cascade: that is a menu you go to, this is
    // a LOOK at one row without leaving your place in the list.
    const [preview, setPreview] = useState<{ flight: FlightLog; at: PreviewAnchor } | null>(null);
    const handleHold = useCallback((flight: FlightLog, at: PreviewAnchor) => {
      // Any open swipe panel would sit under the overlay; close it first.
      window.dispatchEvent(new CustomEvent("swipe-card-close-others", { detail: null }));
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(8);
      setPreview({ flight, at });
    }, []);

    const handleMore = useCallback((flight: FlightLog, at: QuickActionAnchor) => {
      if (Date.now() - closedAtRef.current < CASCADE_REOPEN_GUARD_MS) return;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(6);
      setHeld({ flight, at });
    }, []);

    // Shared by the `…` cascade and the context preview — one action set, one
    // implementation. The caller passes its own flight because the two hold it
    // in different state.
    const handleQuickAction = useCallback(
      async (action: FlightQuickAction, from?: FlightLog) => {
        const source = from ?? held?.flight;
        if (!source) return;
        if (action === "lock") {
          await handleToggleLock(source);
          return;
        }
        if (action === "share") {
          // TODO: sharing a flight (a rendered card / an ICS / a CSV row) is
          // not designed yet. Left as an explicit no-op rather than a menu
          // item that silently does nothing under a different name.
          return;
        }
        const { addFlight } = await import("@/lib/db");
        const created = await addFlight(deriveFlight(source, action as DeriveKind));
        // Placed by the shared comparator, never prepended — see flight-sort.
        mutate(
          CACHE_KEYS.flights,
          (prev: FlightLog[] | undefined) => insertFlightSorted(prev ?? [], created),
          { revalidate: false }
        );
        primeFlightCache(created);
        onEdit?.(created);
      },
      [held, handleToggleLock, onEdit]
    );

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
            data-flight-scroller
            className="h-full overflow-y-auto overscroll-contain"
            style={{ overflowAnchor: "none" }}
            onTouchStart={handleTouchStart}
            onMouseDown={handleTouchStart}
            onWheel={handleWheelStart}
          >
            <div
              style={{ height: topSpacerHeight, transition: topSpacerTransition }}
              className={topSpacerTransition ? undefined : "transition-[height] duration-300 ease-in-out"}
            />
            {headerContent}
            <div className="px-panel pt-2">
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
            data-flight-scroller
            // scrollbar-hide + ScrollIndicator: the native overlay indicator
            // spans from the screen edge over the status bar; the inset
            // replacement starts below the action buttons, like native.
            className="h-full overflow-y-auto flex-1 overscroll-contain scrollbar-hide"
            // `overflow-anchor: none` is load-bearing. When the spacer above
            // the viewport grows (the calendar opening), the browser's scroll
            // ANCHORING compensates by bumping scrollTop the same amount, so
            // the list appears not to move at all — and the adjustment it
            // makes is reported as a downward scroll, which is what hid the
            // nav pill. Anchoring off, the added height simply pushes the
            // content down, at any scroll position.
            style={{ contain: "strict", overflowAnchor: "none" }}
            onTouchStart={handleTouchStart}
            onMouseDown={handleTouchStart}
            onWheel={handleWheelStart}
          >
            <ScrollIndicator />
            {/* Top spacer: the floating chrome, plus the calendar when open */}
            <div
              style={{ height: topSpacerHeight, transition: topSpacerTransition }}
              className={topSpacerTransition ? undefined : "transition-[height] duration-300 ease-in-out"}
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
                      ref={measureRow}
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
                            // Horizontal = the shared --panel-gutter, so the
                            // logbook's cards line up with the detail panel
                            // and the sidebar. Bottom 8px is this list's
                            // per-row gap (its spacer subtracts it).
                            padding: "0 var(--panel-gutter) 8px var(--panel-gutter)",
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
                            onMore={handleMore}
                            onHold={handleHold}
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

            {/* Bottom padding — minus the 8px trailing gap every row wrapper
                already carries, so the LAST card's edge rests on the same
                line as the sidebar's lower end and the other panels' last
                rows (they end flush with their spacers; this list doesn't) */}
            <div style={{ height: "calc(var(--chrome-bottom) - 8px)" }} />
          </div>

          {/* FastScroll rail (year-based navigation) - positioned in visible area below calendar/header */}
          {fastScrollItems.length > 1 && (
            <div
              className="absolute right-0 bottom-0 z-40 flex items-center pointer-events-none transition-[top] duration-300 ease-in-out"
              style={{ top: topSpacerHeight }}
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

        {held && (
          <FlightQuickActions
            flight={held.flight}
            anchor={held.at}
            onSelect={handleQuickAction}
            onClose={closeCascade}
          />
        )}
        {preview && (
          <FlightContextPreview
            flight={preview.flight}
            anchor={preview.at}
            displayPrefs={preferences.display}
            onSelect={(a) => handleQuickAction(a, preview.flight)}
            onClose={() => setPreview(null)}
          />
        )}
      </>
    );
  }
);
