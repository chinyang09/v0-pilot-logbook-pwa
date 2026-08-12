"use client";

import type React from "react";

import {
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
  useEffect,
} from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
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
  /**
   * Max width of ONE month's day grid. In the split layout this is the dual
   * pane's width (`MONTH_PANE_PX`), so a single month is exactly as wide — and
   * therefore exactly as TALL — as one of two. On a phone there is no dual
   * mode to match, so it keeps the wider phone default.
   */
  paneMaxWidth?: number;
  /** Inclusive start of a date range (YYYY-MM-DD). When set together with
   *  rangeEnd, cells in the range are tinted. Independent of selectedDate. */
  rangeStart?: string | null;
  rangeEnd?: string | null;
  /** Optional content rendered above the calendar grid, inside the glass
   *  material when glass mode is active. Use for a date range label etc. */
  header?: React.ReactNode;
  /**
   * Makes each pane's month caption the control that opens the month/year
   * picker. The caption is already there naming the month, so a second
   * expanding label in the header's action bar was saying the same thing
   * twice — and it was the thing that grew the action group into the nav pill.
   */
  onHeaderPress?: () => void;
  /** True while the picker is open, so the caption's chevron can flip. */
  headerActive?: boolean;
}

export interface CalendarHandle {
  scrollToMonth: (year: number, month: number) => void;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Single ↔ dual month slide. Same 300ms as the panels it opens beside. */
const PANE_SLIDE_MS = 300;
const PANE_SLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

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
      paneMaxWidth = 360,
      rangeStart = null,
      rangeEnd = null,
      header,
      onHeaderPress,
      headerActive = false,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    /**
     * Swipe bookkeeping — REFS, not state.
     *
     * None of these three is rendered or read by a memo; they exist only
     * inside the touch handlers. As state, `handleTouchStart` fired three
     * updates and the threshold crossing in `handleTouchMove` a fourth, so
     * merely putting a finger on the calendar re-rendered the whole grid —
     * forty-two day cells, or eighty-four in dual mode — up to three times
     * before anything visible had happened.
     */
    const swipeStartYRef = useRef(0);
    const isSwipingRef = useRef(false);
    const hasTriggeredSwipeStartRef = useRef(false);
    const isExternalScrollRef = useRef(false);

    /* The three-panel month CAROUSEL is gone.
     *
     * It rendered the stepped-to month as an extra absolutely-positioned panel
     * inside a container whose height came from a ref measured "at rest" — and
     * on the FIRST entry into dual mode that rest measurement had never
     * happened, so the container fell to `height: undefined` over absolutely
     * positioned children and the whole calendar collapsed to its padding
     * (measured: 8px, where two months are 280). It never recovered either:
     * the handler that ended the animation tested `dataset.animAnchor`, and
     * `data-anim-anchor=""` reads back as the empty string, which is falsy —
     * so it returned on every event and the calendar stayed collapsed.
     *
     * It was also the wrong motion. A dual step moves the pair by TWO months,
     * so there is no single month sliding across to animate, and the single
     * month view has never animated a step either. The pair now simply
     * re-renders, and the only motion here is the width slide below — which is
     * the one the owner actually asked for.
     */

    // ─── Single ↔ dual: a horizontal slide, not the month carousel ───
    //
    // Think of the pair as two months STACKED on top of each other. Opening to
    // dual, the one that belongs on the right slides out from under the other
    // and takes the right half; closing, it slides back under. Which of them
    // travels never changes — it is always the right-hand month — what changes
    // is which one you were already looking at:
    //
    //   looking at Jul (the left month)  → Jul stays put, Aug emerges from
    //                                      under it and moves right
    //   looking at Aug (the right month) → Aug moves right, revealing Jul
    //                                      underneath in the left half
    //
    // The month CAROUSEL (stepping the pair forward/back) is a different
    // motion and keeps its own animation; this only runs on the width change.
    const [paneAnim, setPaneAnim] = useState<null | "toDual" | "toSingle">(null);
    const prevDualRef = useRef(dualMonth);
    /** The pair that was on screen while dual, so a close knows what leaves. */
    const lastPairRef = useRef<{ year: number; month: number }[] | null>(null);
    /**
     * The month on screen while SINGLE.
     *
     * It cannot be read off `selectedMonth` when the slide starts: the page
     * re-anchors the selection to the pair's first month in the same commit
     * that flips `dualMonth`, so by then "the month you were looking at" is
     * already gone. Looking at August and widening has to slide August right
     * and reveal July underneath — not hold July still and bring August in.
     */
    const lastSingleMonthRef = useRef(selectedMonth);
    const [leavingMonth, setLeavingMonth] = useState<{ year: number; month: number } | null>(null);
    /** While opening: the pane that holds still, i.e. the one already on screen. */
    const [stayingMonth, setStayingMonth] = useState<{ year: number; month: number } | null>(null);

    useEffect(() => {
      const wasDual = prevDualRef.current;
      prevDualRef.current = dualMonth;
      if (wasDual === dualMonth) return;
      if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      // The width change also re-anchors `selectedMonth`, which would
      // otherwise read as a month STEP and fire that slide on top of this one.
      suppressStepRef.current = true;

      if (dualMonth) {
        setLeavingMonth(null);
        setPaneAnim("toDual");
        setStayingMonth(lastSingleMonthRef.current);
      } else {
        // Whichever of the old pair is NOT the month we kept is the one that
        // slides back under it.
        const pair = lastPairRef.current;
        const gone = pair?.find(
          (m) => !(m.year === selectedMonth.year && m.month === selectedMonth.month)
        );
        setLeavingMonth(gone ?? null);
        setPaneAnim("toSingle");
      }
      const t = setTimeout(() => {
        setPaneAnim(null);
        setLeavingMonth(null);
        suppressStepRef.current = false;
      }, PANE_SLIDE_MS);
      return () => clearTimeout(t);
      // selectedMonth is read for the month we KEPT, but a month change of its
      // own must not restart the width slide.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dualMonth]);

    const flightDates = useMemo(() => {
      const dates = new Map<string, { count: number; hasNight: boolean; allFuture: boolean }>();
      flights.forEach((flight) => {
        const date = flight.date;
        const isFuture = !flight.outTime || !flight.inTime;
        const existing = dates.get(date) || { count: 0, hasNight: false, allFuture: true };
        existing.count++;
        if (flight.nightTime && flight.nightTime !== "00:00")
          existing.hasNight = true;
        if (!isFuture) existing.allFuture = false;
        dates.set(date, existing);
      });
      return dates;
    }, [flights]);

    // Days for the currently selected month (used in month/year picker + single month mode)
    const calendarDays = useMemo(
      () => computeMonthDays(selectedMonth.year, selectedMonth.month),
      [selectedMonth]
    );

    // ─── Stepping months: a horizontal slide, single AND dual ───
    //
    // The pair moves TWO months at a time in dual mode, so what slides is the
    // whole view rather than one pane crossing the other — the same motion the
    // single month gets, which never used to animate at all.
    const [step, setStep] = useState<{ dir: 1 | -1; from: { year: number; month: number } } | null>(
      null
    );
    const prevMonthRef = useRef(selectedMonth);
    const suppressStepRef = useRef(false);

    useEffect(() => {
      const prev = prevMonthRef.current;
      prevMonthRef.current = selectedMonth;
      const delta =
        selectedMonth.year * 12 + selectedMonth.month - (prev.year * 12 + prev.month);
      if (delta === 0) return;
      if (suppressStepRef.current) return;
      if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      setStep({ dir: delta > 0 ? 1 : -1, from: prev });
      const t = setTimeout(() => setStep(null), PANE_SLIDE_MS);
      return () => clearTimeout(t);
    }, [selectedMonth]);

    /** The two panes shown side by side: the anchor month and the next one. */
    const carouselMonths = useMemo(() => {
      if (!dualMonth) return null;
      const m0 = selectedMonth;
      const m1 = addMonths(m0.year, m0.month, 1);
      return [
        { ...m0, days: computeMonthDays(m0.year, m0.month) },
        { ...m1, days: computeMonthDays(m1.year, m1.month) },
      ];
    }, [dualMonth, selectedMonth]);

    // Remember the pair on screen, so closing to a single month knows which of
    // the two is the one sliding back under the other.
    useEffect(() => {
      if (!dualMonth) lastSingleMonthRef.current = selectedMonth;
    }, [dualMonth, selectedMonth]);

    useEffect(() => {
      if (dualMonth && carouselMonths && carouselMonths.length >= 2) {
        lastPairRef.current = carouselMonths
          .slice(0, 2)
          .map((m) => ({ year: m.year, month: m.month }));
      }
    }, [dualMonth, carouselMonths]);

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
      swipeStartYRef.current = e.touches[0].clientY;
      isSwipingRef.current = true;
      hasTriggeredSwipeStartRef.current = false;

      if (!isExternalScrollRef.current) {
        onScrollStart?.();
      }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (!isSwipingRef.current) return;

      const diffY = Math.abs(swipeStartYRef.current - e.touches[0].clientY);

      if (
        diffY > 30 &&
        !hasTriggeredSwipeStartRef.current &&
        !isExternalScrollRef.current
      ) {
        hasTriggeredSwipeStartRef.current = true;
        onSwipeStart?.();
      }
    };

    /**
     * One navigation step. In dual-month mode the two panes are a fixed pair
     * (odd month left, even month right), so a step moves TWO months —
     * stepping by one would swap which side each month is on and the pairing
     * would drift out of phase.
     */
    const stepMonths = (forward: boolean) => {
      const delta = (dualMonth ? 2 : 1) * (forward ? 1 : -1);
      const total = selectedMonth.year * 12 + selectedMonth.month + delta;
      onMonthChange(Math.floor(total / 12), ((total % 12) + 12) % 12);
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
      if (!isSwipingRef.current) return;
      isSwipingRef.current = false;

      const diffY = swipeStartYRef.current - e.changedTouches[0].clientY;

      if (Math.abs(diffY) > 50 && !isExternalScrollRef.current) {
        stepMonths(diffY > 0);
      }

      onInteractionEnd?.();
    };

    // Desktop mouse wheel navigation between months
    const handleWheel = (e: React.WheelEvent) => {
      if (Math.abs(e.deltaY) < 10) return;
      if (isExternalScrollRef.current) return;
      onScrollStart?.();

      stepMonths(e.deltaY > 0);
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
            aria-label="Previous year"
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-[var(--on-glass-fill-soft)] active:scale-95 transition-all"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-base font-semibold tabular-nums">{selectedMonth.year}</span>
          <button
            onClick={() => onYearChange?.(selectedMonth.year + 1)}
            aria-label="Next year"
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-[var(--on-glass-fill-soft)] active:scale-95 transition-all"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {/* Month grid — 4×3 */}
        <div className="grid grid-cols-4 gap-1.5 px-1">
          {MONTHS.map((month, i) => {
            // In dual mode BOTH panes are on screen, so both are selected —
            // marking only the anchor left the right-hand month unaccounted
            // for in the picker as well as in the header.
            const isSelected =
              i === selectedMonth.month ||
              (dualMonth && i === (selectedMonth.month + 1) % 12 && selectedMonth.month !== 11);
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
                      ? "bg-[var(--on-glass-accent)] text-primary font-semibold"
                      : "text-[var(--on-glass-label)] active:bg-[var(--on-glass-fill-soft)]"
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
      // Capped and centred. The cap is what keeps a month the same size — and
      // so the same HEIGHT, the cells being square — whether one or two are on
      // screen; see MONTH_PANE_PX. Without any cap a single month stretched to
      // fill the wide panel (7 columns of 84px, the grid going from 313px tall
      // to 519px) for the frames between the panel resizing and the
      // dual-month switch catching up, which flashed a giant calendar.
      <div className="mx-auto w-full" style={{ maxWidth: paneMaxWidth }}>
        <div className="grid grid-cols-7 gap-0 px-1 pt-0.5 pb-0">
          {DAYS.map((day) => (
            <div
              key={day}
              className="text-center text-[10px] font-medium text-[var(--on-glass-muted)] uppercase tracking-wider"
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

            // Range visualization. Endpoints highlight whenever they match,
            // even with only one tap; the connecting tint draws only when
            // both endpoints exist and span more than a single day.
            const hasFullRange =
              !!(rangeStart && rangeEnd) && rangeStart !== rangeEnd;
            const isRangeStart =
              isCurrentMonth && !!rangeStart && dayInfo.dateStr === rangeStart;
            const isRangeEnd =
              isCurrentMonth && !!rangeEnd && dayInfo.dateStr === rangeEnd;
            const isInRange =
              hasFullRange &&
              isCurrentMonth &&
              dayInfo.dateStr >= rangeStart! &&
              dayInfo.dateStr <= rangeEnd!;
            const isRangeMiddle = isInRange && !isRangeStart && !isRangeEnd;

            return (
              <button
                key={`${keyPrefix}${dayIndex}`}
                onClick={() => handleDateClick(dayInfo.dateStr, isCurrentMonth)}
                className={cn(
                  "relative flex items-center justify-center aspect-square p-px",
                  // Continuous pill behind the row of in-range cells.
                  isRangeMiddle && "bg-[var(--on-glass-accent-soft)]",
                  hasFullRange && isRangeStart && "bg-[var(--on-glass-accent-soft)] rounded-l-full",
                  hasFullRange && isRangeEnd && "bg-[var(--on-glass-accent-soft)] rounded-r-full",
                )}
              >
                <div
                  className={cn(
                    "w-full aspect-square flex items-center justify-center text-lg rounded-full transition-all",
                    isCurrentMonth
                      ? "text-foreground"
                      : "text-[var(--on-glass-faint)]",
                    // Suppress flight-date highlighting when the calendar is
                    // in range-pick mode; only the range pill should colour
                    // cells, so the highlighted period reads as one shape.
                    !rangeStart && !rangeEnd && flightInfo && isCurrentMonth && !isSelected && (
                      flightInfo.allFuture
                        ? "font-semibold text-primary ring-1 ring-inset ring-primary/50"
                        : "font-semibold text-primary bg-[var(--on-glass-accent)]"
                    ),
                    isCurrentMonth && isToday && !isSelected && !isRangeStart && !isRangeEnd && "bg-[var(--on-glass-accent-strong)] ring-2 ring-inset ring-primary font-bold",
                    isSelected && "bg-primary text-primary-foreground shadow-md z-10",
                    (isRangeStart || isRangeEnd) && "bg-primary text-primary-foreground shadow-md z-10",
                  )}
                >
                  {dayInfo.date.getDate()}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );

    /**
     * ONE month pane: its caption and its grid.
     *
     * The caption is rendered in SINGLE mode too, even though the header names
     * the month as well. Without it a single month was 12px shorter than a
     * dual pair, so toggling the panel width still resized the calendar and
     * the flight list still had to absorb it — the whole point of capping the
     * pane width was to make those two heights equal.
     */
    /**
     * ONE month pane: just its grid.
     *
     * The month name used to sit above each pane. With two panes that is two
     * captions saying half a thing each; one combined selector above the whole
     * calendar names the range and is a single, obvious control. It also keeps
     * the two modes the same HEIGHT for free — one header row either way,
     * which is what the per-pane caption was doing before.
     */
    const renderPane = (
      _m: { year: number; month: number },
      days: { date: Date; dateStr: string; isCurrentMonth: boolean }[],
      keyPrefix = ""
    ) => (
      <>
        {renderDayGrid(days, keyPrefix)}
      </>
    );

    /**
     * The month(s) for an arbitrary anchor, with no animation state on them —
     * this is what the OUTGOING copy is drawn from while a step slides.
     */
    const renderStaticMonths = (anchor: { year: number; month: number }) => {
      if (!dualMonth) {
        return renderPane(anchor, computeMonthDays(anchor.year, anchor.month), "out-");
      }
      const next = addMonths(anchor.year, anchor.month, 1);
      return (
        <div className="flex">
          {[anchor, next].map((m, i) => (
            <div key={`out-${m.year}-${m.month}`} className="min-w-0 px-1" style={{ flex: "0 0 50%" }}>
              {renderPane(m, computeMonthDays(m.year, m.month), `out${i}-`)}
            </div>
          ))}
        </div>
      );
    };

    /**
     * THE date selector — one control for the whole calendar.
     *
     * In dual mode it names the pair ("Jul – Aug 26"), spelling out both years
     * when they straddle a boundary, because "Dec – Jan 27" would put December
     * in the wrong year. Tapping it opens the month/year picker.
     */
    const rangeLabel = (() => {
      const yy = (y: number) => String(y % 100).padStart(2, "0");
      if (!dualMonth) return `${MONTHS[selectedMonth.month]} ${yy(selectedMonth.year)}`;
      const next = addMonths(selectedMonth.year, selectedMonth.month, 1);
      return next.year === selectedMonth.year
        ? `${MONTHS[selectedMonth.month]} – ${MONTHS[next.month]} ${yy(selectedMonth.year)}`
        : `${MONTHS[selectedMonth.month]} ${yy(selectedMonth.year)} – ${MONTHS[next.month]} ${yy(next.year)}`;
    })();

    const dateSelector = (
      <div className="flex items-center justify-center px-2 pt-1 pb-0.5">
        {onHeaderPress ? (
          <button
            type="button"
            onClick={onHeaderPress}
            aria-label="Select month"
            aria-expanded={headerActive}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[15px] font-semibold text-foreground transition-colors hover:bg-[var(--on-glass-fill-soft)]"
          >
            {rangeLabel}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-[var(--on-glass-muted)] transition-transform",
                headerActive && "rotate-180"
              )}
            />
          </button>
        ) : (
          <span className="px-3 py-1 text-[15px] font-semibold text-foreground">{rangeLabel}</span>
        )}
      </div>
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
        {/* Stepping to another month slides horizontally: the arriving
            month(s) come in from the side you are heading toward and the
            outgoing copy leaves the other way. The outgoing copy is ABSOLUTE
            and the arriving one is in FLOW, so the container keeps its height
            for the whole slide — the old carousel put every panel out of flow
            and measured the height from a ref, which is how it collapsed. */}
      <div className="relative" data-cal-step={step ? "1" : undefined}>
      <div
        style={
          step
            ? ({
                // Stepping FORWARD, the new month arrives from BELOW — the
                // same direction the swipe that asked for it travels.
                "--cal-step-y": step.dir > 0 ? "100%" : "-100%",
                animation: `cal-step-in ${PANE_SLIDE_MS}ms ${PANE_SLIDE_EASE} both`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {dualMonth && carouselMonths ? (
          // ─── Two panes, side by side ───
            <div className="flex">
              {carouselMonths.map((m, i) => {
                // The RIGHT pane is the one that travels — it comes out from
                // under the left one. Whichever pane you were already looking
                // at keeps full opacity throughout; the other one arrives.
                const isRightPane = i === 1;
                const isActivePane =
                  !!stayingMonth &&
                  m.year === stayingMonth.year &&
                  m.month === stayingMonth.month;
                return (
                  <div
                    key={`carousel-${m.year}-${m.month}`}
                    className="relative min-w-0 px-1"
                    style={
                      {
                        flex: "0 0 50%",
                        ...(paneAnim === "toDual"
                          ? {
                              // -100% of its own (half) width lands it exactly
                              // over the left pane — geometrically stacked,
                              // not an arbitrary offset.
                              "--cal-pane-x": isRightPane ? "-100%" : "0%",
                              "--cal-pane-o": isActivePane ? 1 : 0,
                              animation: `cal-pane-settle ${PANE_SLIDE_MS}ms ${PANE_SLIDE_EASE} both`,
                              zIndex: isActivePane ? 1 : 0,
                            }
                          : null),
                      } as React.CSSProperties
                    }
                  >
                    {renderPane(m, m.days, `m${i}-`)}
                  </div>
                );
              })}
            </div>
        ) : (
          // ─── Single month, with the closing slide over it ───
          <div className="relative">
            <div className="relative z-[1]">{renderPane(selectedMonth, calendarDays)}</div>
            {paneAnim === "toSingle" && leavingMonth && (
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 z-0"
                style={
                  {
                    // Converges on the month we kept from the side it was on
                    // and fades as it goes under — the open played backwards.
                    "--cal-pane-x":
                      leavingMonth.month === selectedMonth.month + 1 ||
                      (leavingMonth.month === 0 && selectedMonth.month === 11)
                        ? "50%"
                        : "-50%",
                    animation: `cal-pane-leave ${PANE_SLIDE_MS}ms ${PANE_SLIDE_EASE} both`,
                  } as React.CSSProperties
                }
              >
                {renderPane(
                  leavingMonth,
                  computeMonthDays(leavingMonth.year, leavingMonth.month),
                  "leaving-"
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {step && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0"
          style={
            {
              "--cal-step-y": step.dir > 0 ? "-100%" : "100%",
              animation: `cal-step-out ${PANE_SLIDE_MS}ms ${PANE_SLIDE_EASE} both`,
            } as React.CSSProperties
          }
        >
          {renderStaticMonths(step.from)}
        </div>
      )}
      </div>
      </div>
    );

    // ─── View switcher with crossfade ─────────────────────────
    const activeContent = (
      <div className="relative">
        {/* The one date selector, above whichever view is showing. It is
            OUTSIDE the crossfade so it does not blink when the picker opens —
            it is the control that opened it. */}
        {view === "calendar" && dateSelector}
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
                <div className="text-xs font-medium text-[var(--on-glass-muted)] text-center pb-0.5">
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
          {/* No extra tint here. The calendar used to paint `--background` at
              0.85 over its own glass, which is why it read as a different,
              near-solid material from every other glass surface in the app.
              The shared material now carries that opacity itself
              (`--glass-base`), so this panel is the same slab as the action
              buttons and the nav — one glass, everywhere. */}
          <div className={cn("GlassContent", "flex flex-col w-full pb-0")}>
            {header && <div className="relative">{header}</div>}
            {activeContent}
          </div>
          {/* Keep in step with `GlassContainer` — this is the same material,
              inlined. `GlassBlur` is the face and holds the only full-face
              backdrop-filter; the rest are masked to the rim. */}
          <div className="GlassMaterial">
            <div className="GlassEdgeReflection" />
            <div className="GlassEmbossReflection" />
            <div className="GlassRefraction" />
            <div className="GlassBlur" />
            <div className="Highlight" />
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn("flex flex-col w-full pb-0 overflow-hidden", className)}
      >
        {header}
        {activeContent}
      </div>
    );
  }
);
