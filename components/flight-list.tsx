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
import type { FlightLog, Aircraft, Airport, Personnel } from "@/lib/db";
import { deleteFlight } from "@/lib/db";
import { formatHHMMDisplay } from "@/lib/utils/time";
import { syncService } from "@/lib/sync";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plane,
  Trash2,
  Lock,
  Unlock,
  Sun,
  Moon,
  FileEdit,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface FlightListRef {
  scrollToFlight: (flightId: string, flightDate?: string) => void;
}

interface FlightListProps {
  flights: FlightLog[];
  allFlights?: FlightLog[]; // Added to know all available flights for loading
  isLoading?: boolean;
  onEdit?: (flight: FlightLog) => void;
  onDeleted?: () => void;
  aircraft?: Aircraft[];
  airports?: Airport[];
  personnel?: Personnel[];
  onTopFlightChange?: (flight: FlightLog | null) => void;
  onScrollStart?: () => void;
  onScroll?: (e: React.UIEvent<HTMLElement>) => void;
  showMonthHeaders?: boolean;
  hideFilters?: boolean;
  topSpacerHeight?: number; // Height of the calendar
  headerContent?: React.ReactNode; // Height of the top bar (48px)
}

const SWIPE_THRESHOLD = 80;

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

function parseDateLocal(dateStr: string): Date {
  if (!dateStr || typeof dateStr !== "string") {
    return new Date(); // Return current date as fallback
  }

  const parts = dateStr.split("-");
  if (parts.length !== 3) {
    return new Date();
  }

  let year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  // Handle 2-digit year (YY format) - assume 2000s
  if (year < 100) {
    year = 2000 + year;
  }

  // Validate parsed values
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return new Date();
  }

  return new Date(year, month - 1, day);
}

interface SwipeableFlightCardProps {
  flight: FlightLog;
  onEdit: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  personnel?: Personnel[];
}

const SwipeableFlightCard = memo(function SwipeableFlightCard({
  flight,
  onEdit,
  onDelete,
  onToggleLock,
  personnel = [],
}: SwipeableFlightCardProps) {
  const [swipeX, setSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const isHorizontalSwipe = useRef<boolean | null>(null);

  const isLocked = flight.isLocked || false;
  const isDraft = flight.isDraft || false;

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = null;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX.current;
    const diffY = currentY - startY.current;

    if (
      isHorizontalSwipe.current === null &&
      (Math.abs(diffX) > 10 || Math.abs(diffY) > 10)
    ) {
      isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY);
    }

    if (isHorizontalSwipe.current) {
      if (diffX < 0) {
        setSwipeX(Math.max(diffX, -(SWIPE_THRESHOLD * 2 + 20)));
      } else if (swipeX < 0) {
        setSwipeX(Math.min(0, swipeX + diffX));
      }
    }
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    if (swipeX < -SWIPE_THRESHOLD) {
      setSwipeX(-SWIPE_THRESHOLD * 2);
    } else {
      setSwipeX(0);
    }
  };

  const handleClick = () => {
    if (swipeX < 0) {
      setSwipeX(0);
    } else if (!isLocked) {
      onEdit();
    }
  };

  const flightDate = parseDateLocal(flight.date);
  const day = flightDate.getDate().toString().padStart(2, "0");
  const month = MONTHS[flightDate.getMonth()];
  const year = flightDate.getFullYear().toString().slice(2);

  const totalDayLandings = flight.dayLandings || 0;
  const totalNightLandings = flight.nightLandings || 0;

  const crewNames = useMemo(() => {
    const names: string[] = [];
    names.push(flight.picName);
    names.push(flight.sicName);
    if (flight.additionalCrew && Array.isArray(flight.additionalCrew)) {
      flight.additionalCrew.forEach((crew) => {
        if (crew.name) names.push(crew.name);
      });
    }
    return names;
  }, [flight.picName, flight.sicName, flight.additionalCrew]);

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center transition-opacity",
          swipeX < 0 ? "opacity-100" : "opacity-0"
        )}
        style={{ width: SWIPE_THRESHOLD * 2 }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-20 rounded-none bg-secondary text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
            setSwipeX(0);
          }}
        >
          {isLocked ? (
            <Unlock className="h-5 w-5" />
          ) : (
            <Lock className="h-5 w-5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-20 rounded-none bg-destructive text-destructive-foreground"
          onClick={(e) => {
            e.stopPropagation();
            if (!isLocked) onDelete();
          }}
          disabled={isLocked}
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      </div>

      <Card
        className={cn(
          "bg-card border-border cursor-pointer relative py-0",
          !isSwiping && "transition-transform duration-200",
          isLocked && "opacity-75",
          isDraft && "border-dashed border-primary/50"
        )}
        style={{ transform: `translateX(${swipeX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        <CardContent className="px-3 py-1">
          <div className="flex items-start gap-2">
            <div className="flex flex-col items-center justify-start shrink-0 w-16">
              <div className="text-6xl font-bold leading-none tracking-tight">
                {day}
              </div>
              <div className="text-base text-muted-foreground mt-0.5 tracking-wide">
                {month} {year}
              </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-base font-semibold leading-tight">
                    {flight.outTime?.slice(0, 5) || ""}
                  </span>
                  <div className="flex items-center gap-1 flex-1 justify-center">
                    <div className="h-px flex-1 bg-border " />
                    <span className="text-base font-medium whitespace-nowrap px-1">
                      {formatHHMMDisplay(flight.blockTime)} hrs
                    </span>
                    <div className="h-px flex-1 bg-border " />
                  </div>
                  <span className="text-base font-semibold leading-tight">
                    {flight.inTime?.slice(0, 5) || ""}
                  </span>
                </div>

                <div className="flex items-center justify-between mt-0">
                  <span className="text-2xl font-bold leading-tight tracking-tight">
                    {flight.departureIcao || ""}
                  </span>
                  <span className="text-2xl font-bold leading-tight tracking-tight">
                    {flight.arrivalIcao || ""}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground leading-tight mt-0.5">
                <span>{flight.flightNumber || ""}</span>
                <span>•</span>
                <span>{flight.aircraftReg || ""}</span>
                <span>•</span>
                <span>{flight.aircraftType || ""}</span>
              </div>

              <div className="flex items-center justify-between mt-0.5">
                <div className="text-xs text-muted-foreground truncate flex-1 leading-tight">
                  {crewNames.length > 0 ? crewNames.join(", ") : ""}
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
                  {isDraft && <FileEdit className="h-3 w-3 text-primary" />}
                  {isLocked && (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

export const FlightList = forwardRef<FlightListRef, FlightListProps>(
  function FlightList(
    {
      flights,
      allFlights,
      isLoading,
      onEdit,
      onDeleted,
      aircraft = [],
      airports = [],
      personnel = [],
      onTopFlightChange,
      onScrollStart,
      onScroll,
      showMonthHeaders = false,
      hideFilters = false,
      topSpacerHeight = 0,
      headerContent,
    },
    ref
  ) {
    const [deleteTarget, setDeleteTarget] = useState<FlightLog | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isExternalScrollRef = useRef(false);
    const lastDetectedFlightRef = useRef<string | null>(null);

    // Create virtualizer instance
    const rowVirtualizer = useVirtualizer({
      count: flights.length,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: () => 100, // Estimated height of FlightCard in pixels
      overscan: 5, // Render 5 extra items above/below viewport
    });

    // Get virtual items
    const virtualItems = rowVirtualizer.getVirtualItems();

    useImperativeHandle(
      ref,
      () => ({
        scrollToFlight: (flightId: string) => {
          const index = flights.findIndex((f) => f.id === flightId);
          if (index !== -1) {
            isExternalScrollRef.current = true;
            rowVirtualizer.scrollToIndex(index, {
              align: "start",
              behavior: "smooth",
            });
            setTimeout(() => {
              isExternalScrollRef.current = false;
            }, 600); // Increased timeout to allow smooth scroll to complete
          }
        },
      }),
      [flights, rowVirtualizer]
    );

    const handleScroll = useCallback(() => {
      if (isExternalScrollRef.current) return;
      // Note: onScrollStart is now triggered by touch events, not scroll events
      // This prevents programmatic/momentum scrolls from changing the sync source

      if (!onTopFlightChange || flights.length === 0) return;

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

      if (topFlight && topFlight.id !== lastDetectedFlightRef.current) {
        lastDetectedFlightRef.current = topFlight.id;
        onTopFlightChange(topFlight);
      }
    }, [flights, onTopFlightChange, rowVirtualizer]);

    // Handle user touch/interaction start on flight list
    const handleTouchStart = useCallback(() => {
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

    const handleDelete = async () => {
      if (!deleteTarget) return;
      setIsDeleting(true);
      try {
        await deleteFlight(deleteTarget.id);
        if (navigator.onLine) syncService.fullSync();
        onDeleted?.();
      } finally {
        setIsDeleting(false);
        setDeleteTarget(null);
      }
    };

    const handleToggleLock = async (flight: FlightLog) => {
      const { updateFlight } = await import("@/lib/db");
      await updateFlight(flight.id, { isLocked: !flight.isLocked });
      onDeleted?.();
    };

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
            className="h-full overflow-y-auto"
            onTouchStart={handleTouchStart}
            onMouseDown={handleTouchStart}
          >
            <div
              style={{
                height: `${topSpacerHeight}px`,
                transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
              }}
              className="transition-[height] duration-500 will-change-[height]"
            />
            {headerContent}
            <div className="text-center py-12">
              <Plane className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-foreground">
                No flights logged
              </h3>
              <p className="text-muted-foreground mt-1">
                Add your first flight to get started
              </p>
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        <div
          ref={scrollContainerRef}
          className="h-full overflow-y-auto"
          style={{ contain: "strict" }}
          onTouchStart={handleTouchStart}
          onMouseDown={handleTouchStart}
        >
          {/* Top spacer for calendar */}
          <div
            style={{
              height: `${topSpacerHeight}px`,
              transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
            }}
            className="transition-[height] duration-500 will-change-[height]"
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
            {virtualItems.map((virtualRow) => {
              const flight = flights[virtualRow.index];
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
                    padding: "0 8px 8px 8px",
                  }}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                >
                  <SwipeableFlightCard
                    flight={flight}
                    onEdit={() => onEdit?.(flight)}
                    onDelete={() => setDeleteTarget(flight)}
                    onToggleLock={() => handleToggleLock(flight)}
                    personnel={personnel}
                  />
                </div>
              );
            })}
          </div>

          {/* Bottom padding */}
          <div className="h-16" />
        </div>

        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={() => setDeleteTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Flight</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this flight? This action cannot
                be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }
);
