"use client";

import type React from "react";

import {
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
  useEffect,
  useCallback,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FlightLog } from "@/lib/db";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface LogbookCalendarProps {
  flights: FlightLog[];
  selectedMonth: { year: number; month: number };
  onMonthChange: (year: number, month: number) => void;
  onDateSelect?: (date: string) => void;
  selectedDate?: string | null;
  onScrollStart?: () => void;
  onSwipeStart?: () => void;
  onInteractionEnd?: () => void;
  className?: string;
  /** Render as a glass component with liquid glass layers */
  glass?: boolean;
  /** Corner radius for glass mode (default 20) */
  cornerRadius?: number;
  /** Switch between calendar day grid and month/year picker */
  view?: "calendar" | "monthYear";
  /** Called when a month is selected in monthYear view */
  onMonthSelect?: (year: number, month: number) => void;
  /** Called when year changes in monthYear view */
  onYearChange?: (year: number) => void;
  /** Show two consecutive months side by side (for wide panels ~750px) */
  dualMonth?: boolean;
}

export interface CalendarHandle {
  scrollToMonth: (year: number, month: number) => void;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayLocal(): string {
  return formatDateLocal(new Date());
}

function computeMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: { date: Date; dateStr: string; isCurrentMonth: boolean }[] = [];

  for (let i = 0; i < startDay; i++) {
    const prevDate = new Date(year, month, -(startDay - i - 1));
    days.push({ date: prevDate, dateStr: formatDateLocal(prevDate), isCurrentMonth: false });
  }

  for (let i = 1; i <= daysInMonth; i++) {
    const date = new Date(year, month, i);
    days.push({ date, dateStr: formatDateLocal(date), isCurrentMonth: true });
  }

  const remainingDays = 42 - days.length;
  for (let i = 1; i <= remainingDays; i++) {
    const nextDate = new Date(year, month + 1, i);
    days.push({ date: nextDate, dateStr: formatDateLocal(nextDate), isCurrentMonth: false });
  }

  return days;
}

function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const total = year * 12 + month + offset;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export const LogbookCalendar = forwardRef<CalendarHandle, LogbookCalendarProps>(
  function LogbookCalendar(
    {
      flights,
      selectedMonth,
      onMonthChange,
      onDateSelect,
      selectedDate,
      onScrollStart,
      onSwipeStart,
      onInteractionEnd,
      className,
      glass = false,
      cornerRadius = 20,
      view = "calendar",
      onMonthSelect,
      onYearChange,
      dualMonth = false,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const carouselRef = useRef<HTMLDivElement>(null);
    const carouselHeightRef = useRef(0);
    const [swipeStartY, setSwipeStartY] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [hasTriggeredSwipeStart, setHasTriggeredSwipeStart] = useState(false);
    const isExternalScrollRef = useRef(false);

    // ─── Carousel animation state (dual month only) ─────────────
    const [displayMonth, setDisplayMonth] = useState(selectedMonth);
    const [slideDirection, setSlideDirection] = useState<"none" | "forward" | "backward">("none");
    const [isAnimating, setIsAnimating] = useState(false);
    const isAnimatingRef = useRef(false);
    const prevSelectedRef = useRef(selectedMonth);

    // Measure carousel height when at rest (used during animation to keep container stable)
    useEffect(() => {
      if (!isAnimating && carouselRef.current) {
        const h = carouselRef.current.offsetHeight;
        if (h > 0) carouselHeightRef.current = h;
      }
    }, [isAnimating, displayMonth]);

    useEffect(() => {
      const prev = prevSelectedRef.current;
      prevSelectedRef.current = selectedMonth;

      if (!dualMonth) {
        setDisplayMonth(selectedMonth);
        setSlideDirection("none");
        setIsAnimating(false);
        isAnimatingRef.current = false;
        return;
      }

      const prevTotal = prev.year * 12 + prev.month;
      const newTotal = selectedMonth.year * 12 + selectedMonth.month;

      if (prevTotal === newTotal) return;

      if (isAnimatingRef.current) {
        // Rapid swipe: snap immediately to avoid visual glitches
        setDisplayMonth(selectedMonth);
        setSlideDirection("none");
        setIsAnimating(false);
        isAnimatingRef.current = false;
        return;
      }

      // Skip animation for reduced motion
      if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setDisplayMonth(selectedMonth);
        return;
      }

      setSlideDirection(newTotal > prevTotal ? "forward" : "backward");
      setIsAnimating(true);
      isAnimatingRef.current = true;
    }, [selectedMonth, dualMonth]);

    const handleAnimEnd = useCallback((e: React.AnimationEvent) => {
      // Only snap when the anchor (shifting) panel finishes
      if (!(e.target as HTMLElement).dataset.animAnchor) return;
      setDisplayMonth(selectedMonth);
      setIsAnimating(false);
      isAnimatingRef.current = false;
      setSlideDirection("none");
    }, [selectedMonth]);

    const flightDates = useMemo(() => {
      const dates = new Map<string, { count: number; hasNight: boolean }>();
      flights.forEach((flight) => {
        const date = flight.date;
        const existing = dates.get(date) || { count: 0, hasNight: false };
        existing.count++;
        if (flight.nightTime && flight.nightTime !== "00:00")
          existing.hasNight = true;
        dates.set(date, existing);
      });
      return dates;
    }, [flights]);

    // Days for the currently selected month (used in month/year picker + single month mode)
    const calendarDays = useMemo(
      () => computeMonthDays(selectedMonth.year, selectedMonth.month),
      [selectedMonth]
    );

    // For dual month carousel, compute months based on displayMonth (lags behind during animation)
    const carouselMonths = useMemo(() => {
      if (!dualMonth) return null;

      const m0 = displayMonth;
      const m1 = addMonths(m0.year, m0.month, 1);

      const base = [
        { ...m0, days: computeMonthDays(m0.year, m0.month) },
        { ...m1, days: computeMonthDays(m1.year, m1.month) },
      ];

      if (slideDirection === "forward") {
        const m2 = addMonths(m0.year, m0.month, 2);
        return [...base, { ...m2, days: computeMonthDays(m2.year, m2.month) }];
      }
      if (slideDirection === "backward") {
        const mPrev = addMonths(m0.year, m0.month, -1);
        return [{ ...mPrev, days: computeMonthDays(mPrev.year, mPrev.month) }, ...base];
      }

      return base;
    }, [dualMonth, displayMonth, slideDirection]);

    // Backwards compat: nextMonthData for the month/year picker view
    const nextMonthData = useMemo(() => {
      if (!dualMonth) return null;
      const next = addMonths(selectedMonth.year, selectedMonth.month, 1);
      return { ...next, days: computeMonthDays(next.year, next.month) };
    }, [selectedMonth, dualMonth]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToMonth: (year: number, month: number) => {
          isExternalScrollRef.current = true;
          setTimeout(() => {
            isExternalScrollRef.current = false;
          }, 400);
        },
      }),
      []
    );

    const handleTouchStart = (e: React.TouchEvent) => {
      setSwipeStartY(e.touches[0].clientY);
      setIsSwiping(true);
      setHasTriggeredSwipeStart(false);

      if (!isExternalScrollRef.current) {
        onScrollStart?.();
      }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (!isSwiping) return;

      const diffY = Math.abs(swipeStartY - e.touches[0].clientY);

      if (
        diffY > 30 &&
        !hasTriggeredSwipeStart &&
        !isExternalScrollRef.current
      ) {
        setHasTriggeredSwipeStart(true);
        onSwipeStart?.();
      }
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
      if (!isSwiping) return;
      setIsSwiping(false);

      const diffY = swipeStartY - e.changedTouches[0].clientY;

      if (Math.abs(diffY) > 50 && !isExternalScrollRef.current) {
        let newYear = selectedMonth.year;
        let newMonth = selectedMonth.month;

        if (diffY > 0) {
          newMonth = selectedMonth.month === 11 ? 0 : selectedMonth.month + 1;
          newYear =
            selectedMonth.month === 11
              ? selectedMonth.year + 1
              : selectedMonth.year;
        } else {
          newMonth = selectedMonth.month === 0 ? 11 : selectedMonth.month - 1;
          newYear =
            selectedMonth.month === 0
              ? selectedMonth.year - 1
              : selectedMonth.year;
        }

        onMonthChange(newYear, newMonth);
      }

      onInteractionEnd?.();
    };

    // Desktop mouse wheel navigation between months
    const handleWheel = (e: React.WheelEvent) => {
      if (Math.abs(e.deltaY) < 10) return;
      if (isExternalScrollRef.current) return;
      onScrollStart?.();

      let newYear = selectedMonth.year;
      let newMonth = selectedMonth.month;

      if (e.deltaY > 0) {
        newMonth = selectedMonth.month === 11 ? 0 : selectedMonth.month + 1;
        newYear = selectedMonth.month === 11 ? selectedMonth.year + 1 : selectedMonth.year;
      } else {
        newMonth = selectedMonth.month === 0 ? 11 : selectedMonth.month - 1;
        newYear = selectedMonth.month === 0 ? selectedMonth.year - 1 : selectedMonth.year;
      }

      onMonthChange(newYear, newMonth);
    };

    const handleDateClick = (dateStr: string, isCurrentMonth: boolean) => {
      if (isCurrentMonth) {
        onDateSelect?.(dateStr);
      }
    };

    const today = getTodayLocal();
    const nowMonth = new Date().getMonth();
    const nowYear = new Date().getFullYear();

    // ─── Month/Year picker view ───────────────────────────────
    const monthYearContent = (
      <div className="px-2 py-2">
        {/* Year navigation */}
        <div className="flex items-center justify-between mb-3 px-1">
          <button
            onClick={() => onYearChange?.(selectedMonth.year - 1)}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-foreground/5 active:scale-95 transition-all"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-base font-semibold tabular-nums">{selectedMonth.year}</span>
          <button
            onClick={() => onYearChange?.(selectedMonth.year + 1)}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-foreground/5 active:scale-95 transition-all"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {/* Month grid — 4×3 */}
        <div className="grid grid-cols-4 gap-1.5 px-1">
          {MONTHS.map((month, i) => {
            const isSelected = i === selectedMonth.month;
            const isCurrent = i === nowMonth && selectedMonth.year === nowYear;
            return (
              <button
                key={month}
                onClick={() => onMonthSelect?.(selectedMonth.year, i)}
                className={cn(
                  "h-10 rounded-xl text-sm font-medium transition-all active:scale-95",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : isCurrent
                      ? "bg-primary/15 text-primary font-semibold"
                      : "text-foreground/70 active:bg-foreground/5"
                )}
              >
                {month}
              </button>
            );
          })}
        </div>
      </div>
    );

    // ─── Reusable day grid renderer ────────────────────────────
    const renderDayGrid = (
      days: { date: Date; dateStr: string; isCurrentMonth: boolean }[],
      keyPrefix = ""
    ) => (
      <>
        <div className="grid grid-cols-7 gap-0 px-1 pt-0.5 pb-0">
          {DAYS.map((day) => (
            <div
              key={day}
              className="text-center text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0 px-1">
          {days.map((dayInfo, dayIndex) => {
            const flightInfo = flightDates.get(dayInfo.dateStr);
            const isCurrentMonth = dayInfo.isCurrentMonth;
            const isToday = dayInfo.dateStr === today;
            const isSelected = isCurrentMonth && dayInfo.dateStr === selectedDate;

            return (
              <button
                key={`${keyPrefix}${dayIndex}`}
                onClick={() => handleDateClick(dayInfo.dateStr, isCurrentMonth)}
                className="flex items-center justify-center aspect-square p-px"
              >
                <div
                  className={cn(
                    "w-full aspect-square flex items-center justify-center text-lg rounded-full transition-all",
                    isCurrentMonth
                      ? "text-foreground/90"
                      : "text-foreground/[0.06]",
                    flightInfo && isCurrentMonth && !isSelected && "font-semibold text-primary bg-primary/20",
                    isCurrentMonth && isToday && "ring-1.5 ring-primary/60",
                    isSelected && "bg-primary text-primary-foreground shadow-md z-10"
                  )}
                >
                  {dayInfo.date.getDate()}
                </div>
              </button>
            );
          })}
        </div>
      </>
    );

    // ─── Calendar day grid view ───────────────────────────────
    const calendarContent = (
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden touch-none"
        style={{ contain: "layout", touchAction: "none" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
        {dualMonth && carouselMonths ? (
          isAnimating && carouselMonths.length === 3 ? (
            // ─── Animated state: 3 panels with individual CSS keyframe animations ───
            <div
              ref={carouselRef}
              className="relative overflow-hidden"
              style={{ height: carouselHeightRef.current || undefined }}
              onAnimationEnd={handleAnimEnd}
            >
              {slideDirection === "forward" ? (
                <>
                  {/* Panel A: left month exits upward */}
                  <div
                    className="absolute top-0 left-0 w-1/2 px-1"
                    style={{ animation: "cal-exit-up 300ms ease-out forwards" }}
                  >
                    <div className="text-xs font-medium text-muted-foreground/50 text-center pb-0.5">
                      {MONTHS[carouselMonths[0].month]} {carouselMonths[0].year}
                    </div>
                    {renderDayGrid(carouselMonths[0].days, "m0-")}
                  </div>
                  {/* Panel B: right month shifts left (anchor) */}
                  <div
                    data-anim-anchor=""
                    className="absolute top-0 left-1/2 w-1/2 px-1"
                    style={{ animation: "cal-shift-left 300ms ease-out forwards" }}
                  >
                    <div className="text-xs font-medium text-muted-foreground/50 text-center pb-0.5">
                      {MONTHS[carouselMonths[1].month]} {carouselMonths[1].year}
                    </div>
                    {renderDayGrid(carouselMonths[1].days, "m1-")}
                  </div>
                  {/* Panel C: new right month enters from top */}
                  <div
                    className="absolute top-0 left-1/2 w-1/2 px-1"
                    style={{ animation: "cal-enter-top 300ms ease-out forwards" }}
                  >
                    <div className="text-xs font-medium text-muted-foreground/50 text-center pb-0.5">
                      {MONTHS[carouselMonths[2].month]} {carouselMonths[2].year}
                    </div>
                    {renderDayGrid(carouselMonths[2].days, "m2-")}
                  </div>
                </>
              ) : (
                <>
                  {/* Panel Z: new left month enters from top */}
                  <div
                    className="absolute top-0 left-0 w-1/2 px-1"
                    style={{ animation: "cal-enter-top 300ms ease-out forwards" }}
                  >
                    <div className="text-xs font-medium text-muted-foreground/50 text-center pb-0.5">
                      {MONTHS[carouselMonths[0].month]} {carouselMonths[0].year}
                    </div>
                    {renderDayGrid(carouselMonths[0].days, "m0-")}
                  </div>
                  {/* Panel A: left month shifts right (anchor) */}
                  <div
                    data-anim-anchor=""
                    className="absolute top-0 left-0 w-1/2 px-1"
                    style={{ animation: "cal-shift-right 300ms ease-out forwards" }}
                  >
                    <div className="text-xs font-medium text-muted-foreground/50 text-center pb-0.5">
                      {MONTHS[carouselMonths[1].month]} {carouselMonths[1].year}
                    </div>
                    {renderDayGrid(carouselMonths[1].days, "m1-")}
                  </div>
                  {/* Panel B: right month exits upward */}
                  <div
                    className="absolute top-0 left-1/2 w-1/2 px-1"
                    style={{ animation: "cal-exit-up 300ms ease-out forwards" }}
                  >
                    <div className="text-xs font-medium text-muted-foreground/50 text-center pb-0.5">
                      {MONTHS[carouselMonths[2].month]} {carouselMonths[2].year}
                    </div>
                    {renderDayGrid(carouselMonths[2].days, "m2-")}
                  </div>
                </>
              )}
            </div>
          ) : (
            // ─── Resting state: 2 panels in a flex row ───
            <div ref={carouselRef} className="flex">
              {carouselMonths.map((m, i) => (
                <div
                  key={`carousel-${m.year}-${m.month}`}
                  className="min-w-0 px-1"
                  style={{ flex: "0 0 50%" }}
                >
                  <div className="text-xs font-medium text-muted-foreground/50 text-center pb-0.5">
                    {MONTHS[m.month]} {m.year}
                  </div>
                  {renderDayGrid(m.days, `m${i}-`)}
                </div>
              ))}
            </div>
          )
        ) : (
          renderDayGrid(calendarDays)
        )}
      </div>
    );

    // ─── View switcher with crossfade ─────────────────────────
    const activeContent = (
      <div className="relative">
        {/* Calendar view */}
        <div
          style={{
            opacity: view === "calendar" ? 1 : 0,
            visibility: view === "calendar" ? "visible" : "hidden",
            transition: "opacity 0.15s ease-in-out",
          }}
        >
          {calendarContent}
        </div>
        {/* Month/Year picker view — absolute overlay for crossfade */}
        <div
          className="absolute inset-0"
          style={{
            opacity: view === "monthYear" ? 1 : 0,
            visibility: view === "monthYear" ? "visible" : "hidden",
            transition: "opacity 0.15s ease-in-out",
          }}
        >
          {dualMonth && view === "monthYear" ? (
            <div className="flex gap-2">
              <div
                className="flex-1 min-w-0 touch-none"
                style={{ touchAction: "none" }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onWheel={handleWheel}
              >
                <div className="text-xs font-medium text-muted-foreground/50 text-center pb-0.5">
                  {MONTHS[selectedMonth.month]} {selectedMonth.year}
                </div>
                {renderDayGrid(calendarDays, "m1-")}
              </div>
              <div className="flex-1 min-w-0">{monthYearContent}</div>
            </div>
          ) : (
            monthYearContent
          )}
        </div>
      </div>
    );

    if (glass) {
      return (
        <div
          className={cn("GlassContainer", className)}
          style={{ "--corner-radius": `${cornerRadius}px` } as React.CSSProperties}
        >
          <div className={cn("GlassContent", "flex flex-col w-full pb-0")}>
            {/* Dark tint overlay for contrast against flight card text behind glass */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "var(--background)",
                opacity: 0.85,
                borderRadius: "inherit",
              }}
            />
            {activeContent}
          </div>
          <div className="GlassMaterial">
            <div className="GlassEdgeReflection" />
            <div className="GlassEmbossReflection" />
            <div className="GlassRefraction" />
            <div className="GlassBlur" />
            <div className="BlendLayers" />
            <div className="BlendEdge" />
            <div className="Highlight" />
            <div className="Contrast" />
            <div className="Brightness" />
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn("flex flex-col w-full pb-0 overflow-hidden", className)}
      >
        {activeContent}
      </div>
    );
  }
);
