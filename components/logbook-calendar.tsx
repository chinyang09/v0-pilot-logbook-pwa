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
import { ChevronDown, Layers } from "lucide-react";
import { WheelPicker, WheelPickerWrapper } from "@ncdai/react-wheel-picker";
import "@ncdai/react-wheel-picker/style.css";
import { wheelClassNames } from "@/components/ui/wheel-styles";
import type { FlightLog } from "@/lib/db";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/utils/date";
import { fitScale, labelWidth, onFontsReady } from "@/lib/utils/text-fit";
import { layoutWeek, type BarTone, type WeekLayout } from "@/lib/utils/roster/calendar-bars";
import { setCalendarDuties, useCalendarDuties, useCalendarSpans } from "@/hooks/use-calendar-spans";

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
  /**
   * Called as the month/year wheels settle on a month. The picker stays open
   * (it is live); the date selector closes it.
   */
  onMonthSelect?: (year: number, month: number) => void;
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
  /** Offers a Today button in the header. */
  onToday?: () => void;
}

export interface CalendarHandle {
  scrollToMonth: (year: number, month: number) => void;
}

const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PICKER_MONTHS = MONTHS_FULL.map((label, value) => ({ value, label }));
/** Rows of the month/year wheels — 34px keeps the wheel (~218px) inside a dual pane's grid. */
const WHEEL_ITEM_PX = 34;
/** A career back, a roster ahead. The year being viewed is always offered. */
const PICKER_PAST_YEARS = 70;
const PICKER_FUTURE_YEARS = 5;
/**
 * The year wheel's rows, the SAME array while the range holds. The range is
 * anchored on TODAY and only widens when the viewed year falls outside it:
 * anchored on the viewed year as well, every year spun shifted the range and
 * handed the wheel a new list of ~75 rows to rebuild (measured at a 4×
 * throttle: ~165ms of main thread per settled step).
 */
let yearOptionsCache: { key: string; options: { value: number; label: string }[] } | null = null;
function yearOptions(from: number, to: number) {
  const key = `${from}-${to}`;
  if (yearOptionsCache?.key !== key) {
    yearOptionsCache = {
      key,
      options: Array.from({ length: to - from + 1 }, (_, i) => ({ value: from + i, label: String(from + i) })),
    };
  }
  return yearOptionsCache.options;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A week row: the day number's line, then THREE one-line lanes, then a
 * hairline of air — the owner's reference (a desktop calendar app): three
 * things a day, each one line ("TR560 RPMD", "LOFF"), what falls past them
 * counted beside the date ("+1"). Fixed, so every row and every month is the
 * same height and stepping months never moves anything under the calendar.
 */
const DAY_LINE_PX = 17;
const LANE_PX = 14;
const ROW_PAD_PX = 3;
const LANES = 3;

/**
 * A DUTY is a solid bar, white type on its type's colour — the shape of the
 * month (a run of leave, days off) reads before a word does. -700 on every hue
 * keeps white 9px type at 4.5:1 and over.
 */
const DUTY_BAR: Record<string, string> = {
  standby: "bg-amber-700 text-white",
  training: "bg-purple-700 text-white",
  leave: "bg-green-700 text-white",
  off: "bg-slate-600 text-white",
  ground: "bg-orange-700 text-white",
  positioning: "bg-cyan-700 text-white",
  other: "bg-slate-600 text-white",
};

/**
 * A FLIGHT is coloured TEXT, no fill — the reference's own split, and it is
 * what keeps a day with three sectors legible: three filled chips stacked in a
 * 50px cell read as a block. Still to fly is the accent (planned, as on the
 * logbook card), flown the plain record, a past sector with no times the amber
 * of "not logged", a simulator teal.
 */
function barTone(tone: BarTone): string {
  if (tone.kind === "duty") return DUTY_BAR[tone.dutyType] ?? DUTY_BAR.other;
  switch (tone.state) {
    case "flown":
      return "text-foreground";
    case "unlogged":
      return "text-status-warning";
    case "sim":
      return "text-teal-700 dark:text-teal-300";
    default:
      return "text-primary";
  }
}

type GridDay = { date: Date; dateStr: string; isCurrentMonth: boolean };

/** Week rows a month spans, Sunday-first. */
function weeksIn(year: number, month: number): number {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return Math.ceil((first + days) / 7);
}

function nextMonthOf(m: { year: number; month: number }): [number, number] {
  return m.month === 11 ? [m.year + 1, 0] : [m.year, m.month + 1];
}

/** The month's six week rows, each laid out against the spans. */
function weeksOf(days: GridDay[], spans: Parameters<typeof layoutWeek>[1], maxLanes: number) {
  const weeks: { days: GridDay[]; layout: WeekLayout }[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    weeks.push({ days: week, layout: layoutWeek(week.map((d) => d.dateStr), spans, maxLanes) });
  }
  return weeks;
}

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
      dualMonth = false,
      paneMaxWidth,
      rangeStart = null,
      rangeEnd = null,
      header,
      onHeaderPress,
      headerActive = false,
      onToday,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);

    // One day's width, so a label can be condensed to fit it (see text-fit).
    // Read from a ResizeObserver — after layout, never in a commit — off the
    // first week row; every pane is the same width.
    const [cellPx, setCellPx] = useState(0);
    const [, setFontsTick] = useState(0);
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        const row = el.querySelector<HTMLElement>("[data-cal-week]");
        if (row) setCellPx(row.clientWidth / 7);
      });
      ro.observe(el);
      const stop = onFontsReady(() => setFontsTick((n) => n + 1));
      return () => {
        ro.disconnect();
        stop();
      };
    }, []);
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

    // Every flight and duty the month draws, filtered by the Duties toggle.
    const spans = useCalendarSpans(flights);
    const showDuties = useCalendarDuties();
    // Only the weeks the month spans (4–6), the same for both panes of a
    // pair, rather than a fixed six with a row of next month's days.
    const weekRows = dualMonth
      ? Math.max(weeksIn(selectedMonth.year, selectedMonth.month), weeksIn(...nextMonthOf(selectedMonth)))
      : weeksIn(selectedMonth.year, selectedMonth.month);
    // The month(s) on screen, laid out ONCE per change of data or month: the
    // page re-renders the calendar as its list scrolls (the selected day
    // follows the top flight), and each layout is a pass over every span.
    const paneLayouts = useMemo(() => {
      const map = new Map<string, ReturnType<typeof weeksOf>>();
      const months = dualMonth
        ? [selectedMonth, addMonths(selectedMonth.year, selectedMonth.month, 1)]
        : [selectedMonth];
      for (const m of months) {
        const days = computeMonthDays(m.year, m.month);
        map.set(`${days[0].dateStr}|${weekRows}`, weeksOf(days.slice(0, weekRows * 7), spans, LANES));
      }
      return map;
    }, [spans, selectedMonth, dualMonth, weekRows]);
    const layoutsFor = (days: GridDay[], rows: number) =>
      paneLayouts.get(`${days[0].dateStr}|${rows}`) ?? weeksOf(days.slice(0, rows * 7), spans, LANES);

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
    const nowYear = new Date().getFullYear();

    // ─── Month/Year picker view ───────────────────────────────
    //
    // Two WHEELS, month and year — what iOS's own inline date picker turns its
    // grid into when its month is tapped, and the same wheel the app's date
    // and time pickers use. It replaced a 4×3 grid of month capsules under a
    // year stepper: a year away was a tap per year, and the grid read as a
    // web page's form rather than the platform's control.
    //
    // It changes the month LIVE (`onMonthSelect` per settled spin) and stays
    // open; the date selector above it, whose chevron is flipped, closes it.
    //
    // On a phone it REPLACES the day grid in the same box; in the dual layout
    // it takes the RIGHT pane and the month it is on stays drawn on the LEFT,
    // so the pilot sees the month they are choosing as they choose it. Either
    // way it sits inside the day grid's own box, so the panel's height never
    // moves (WHEEL_ITEM_PX is what keeps the wheel inside a dual pane).
    const pickerYears = yearOptions(
      Math.min(nowYear - PICKER_PAST_YEARS, selectedMonth.year),
      Math.max(nowYear + PICKER_FUTURE_YEARS, selectedMonth.year)
    );
    const monthYearContent = (
      <div
        className="mx-auto flex h-full w-full items-center px-3"
        style={{ maxWidth: paneMaxWidth }}
      >
        <WheelPickerWrapper className="w-full">
          <div className="flex-[3]">
            <WheelPicker
              options={PICKER_MONTHS}
              value={selectedMonth.month}
              onValueChange={(m) => {
                if (m !== selectedMonth.month) onMonthSelect?.(selectedMonth.year, m as number);
              }}
              infinite
              optionItemHeight={WHEEL_ITEM_PX}
              visibleCount={20}
              classNames={wheelClassNames("start", false, glass ? "glass" : "card")}
            />
          </div>
          <div className="flex-[2]">
            <WheelPicker
              options={pickerYears}
              value={selectedMonth.year}
              onValueChange={(y) => {
                if (y !== selectedMonth.year) onMonthSelect?.(y as number, selectedMonth.month);
              }}
              optionItemHeight={WHEEL_ITEM_PX}
              visibleCount={20}
              classNames={wheelClassNames("end", true, glass ? "glass" : "card")}
            />
          </div>
        </WheelPickerWrapper>
      </div>
    );

    // ─── The month as BARS ──────────────────────────────────────
    //
    // A grid of day cells with the day's flights and duties laid over it as
    // bars (`lib/utils/roster/calendar-bars.ts`): a day says what it IS
    // ("TR560 RPMD", "LOFF"), a flight across midnight runs from the middle of
    // one day to the middle of the next, and a run of leave is one bar. Rows
    // are one fixed height (three lanes); what does not fit a day is counted
    // ("+1").
    const renderDayGrid = (
      days: { date: Date; dateStr: string; isCurrentMonth: boolean }[],
      keyPrefix = "",
      rows = weekRows
    ) => {
      const weeks = layoutsFor(days, rows);
      const rowHeight = DAY_LINE_PX + LANES * LANE_PX + ROW_PAD_PX;
      const hasFullRange = !!(rangeStart && rangeEnd) && rangeStart !== rangeEnd;
      return (
        <div className="mx-auto w-full" style={{ maxWidth: paneMaxWidth }}>
          <div className="grid grid-cols-7 gap-0 px-1 pt-0.5 pb-0.5">
            {DAYS.map((day) => (
              <div
                key={day}
                className="text-center text-[10px] font-medium text-[var(--on-glass-label)] uppercase tracking-wider"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="px-1">
            {weeks.map((week, w) => (
              // Each row is its own layout and paint island: the bars are
              // absolute inside it, so nothing in a row reaches past it.
              <div key={`${keyPrefix}w${w}`} data-cal-week className="relative" style={{ height: rowHeight, contain: "layout paint" }}>
                <div className="grid h-full grid-cols-7">
                  {week.days.map((dayInfo, col) => {
                    const isCurrentMonth = dayInfo.isCurrentMonth;
                    const isToday = dayInfo.dateStr === today;
                    const isSelected = isCurrentMonth && dayInfo.dateStr === selectedDate;
                    const isRangeEnd =
                      isCurrentMonth &&
                      ((!!rangeStart && dayInfo.dateStr === rangeStart) || (!!rangeEnd && dayInfo.dateStr === rangeEnd));
                    const isInRange =
                      hasFullRange && isCurrentMonth && dayInfo.dateStr >= rangeStart! && dayInfo.dateStr <= rangeEnd!;
                    const hidden = week.layout.hidden[col];
                    const labels = week.layout.bars
                      .filter((b) => b.start < (col + 1) * 2 && b.end > col * 2)
                      .map((b) => (b.span.detail ? `${b.span.label} ${b.span.detail}` : b.span.label));
                    return (
                      <button
                        key={`${keyPrefix}${w}-${col}`}
                        type="button"
                        tabIndex={isCurrentMonth ? undefined : -1}
                        aria-label={`${formatDay(dayInfo.dateStr)}${labels.length ? `, ${labels.join(", ")}` : ""}${hidden ? `, and ${hidden} more` : ""}`}
                        aria-pressed={isSelected || undefined}
                        aria-current={isToday ? "date" : undefined}
                        onClick={() => handleDateClick(dayInfo.dateStr, isCurrentMonth)}
                        className={cn(
                          "relative flex h-full min-w-0 items-start justify-between border-t border-[var(--on-glass-fill)] px-1 pt-0.5 text-left transition-colors",
                          col > 0 && "border-l",
                          !isCurrentMonth && "bg-[var(--on-glass-fill-soft)]",
                          // Today is the whole CELL, shaded, as in a desk
                          // calendar — a circle on the number was a small
                          // mark to find in a grid of busy days.
                          isToday && "bg-[var(--on-glass-fill)]",
                          isInRange && "bg-[var(--on-glass-accent-soft)]",
                          isRangeEnd && "bg-[var(--on-glass-accent)]",
                          isSelected && "bg-[var(--on-glass-accent-soft)] ring-2 ring-inset ring-primary",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-[3px] text-[11px] leading-none tabular-nums",
                            isCurrentMonth ? "text-foreground" : "text-[var(--on-glass-faint)]",
                            isToday && "font-bold text-primary",
                          )}
                        >
                          {dayInfo.date.getDate()}
                        </span>
                        {hidden > 0 && (
                          <span className="text-[9px] font-semibold leading-[15px] text-[var(--on-glass-muted)]">
                            +{hidden}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* The bars ride over the cells and take no taps: a tap is the
                    DAY's, which is what the page scrolls to. */}
                <div aria-hidden className="pointer-events-none absolute inset-x-0" style={{ top: DAY_LINE_PX }}>
                  {week.layout.bars.map((bar) => {
                    const startCol = Math.floor(bar.start / 2);
                    const dim = !week.days[Math.min(startCol, 6)].isCurrentMonth && !week.days[Math.min(Math.ceil(bar.end / 2) - 1, 6)].isCurrentMonth;
                    const isDuty = bar.span.tone.kind === "duty";
                    const text = bar.span.detail && !dualMonth ? `${bar.span.label} ${bar.span.detail}` : bar.span.label;
                    // Condensed by exactly what it needs to sit on one line:
                    // the bar's width less its 1px insets and padding.
                    const natural = labelWidth(text);
                    const available =
                      ((bar.end - bar.start) / 2) * cellPx -
                      (bar.continuesLeft ? 0 : 1) -
                      (bar.continuesRight ? 0 : 1) -
                      (isDuty ? 8 : 4);
                    const scale = cellPx > 0 ? fitScale(natural, available) : 1;
                    return (
                      <div
                        key={`${keyPrefix}${bar.key}`}
                        className={cn(
                          "absolute flex items-center overflow-hidden whitespace-nowrap text-[9px] font-semibold leading-none tracking-[-0.02em]",
                          barTone(bar.span.tone),
                          // A duty is a bar; a flight is text on the day.
                          isDuty ? "rounded-[3px] px-1" : "px-[2px]",
                          bar.continuesLeft && "rounded-l-none",
                          bar.continuesRight && "rounded-r-none",
                          dim && "opacity-50",
                        )}
                        style={{
                          top: bar.lane * LANE_PX,
                          height: LANE_PX - 2,
                          left: `calc(${(bar.start / 14) * 100}% + ${bar.continuesLeft ? 0 : 1}px)`,
                          width: `calc(${((bar.end - bar.start) / 14) * 100}% - ${(bar.continuesLeft ? 0 : 1) + (bar.continuesRight ? 0 : 1)}px)`,
                        }}
                      >
                        {/* ONE line: "TR560 RPMD". Clipped, never ellipsed —
                            "TR56…" loses the digit that says which flight. In
                            the two-month layout a day is ~40px, so a flight
                            is its number alone there. */}
                        <span
                          className="inline-block shrink-0"
                          style={
                            scale < 1 && natural
                              ? { width: natural, transform: `scaleX(${scale})`, transformOrigin: "left center" }
                              : undefined
                          }
                        >
                          {text}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    };


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
      keyPrefix = "",
      rows = weekRows
    ) => (
      <>
        {renderDayGrid(days, keyPrefix, rows)}
      </>
    );

    /**
     * The month(s) for an arbitrary anchor, with no animation state on them —
     * this is what the OUTGOING copy is drawn from while a step slides.
     */
    const renderStaticMonths = (anchor: { year: number; month: number }) => {
      if (!dualMonth) {
        return renderPane(anchor, computeMonthDays(anchor.year, anchor.month), "out-", weeksIn(anchor.year, anchor.month));
      }
      const next = addMonths(anchor.year, anchor.month, 1);
      const rows = Math.max(weeksIn(anchor.year, anchor.month), weeksIn(next.year, next.month));
      return (
        <div className="flex">
          {[anchor, next].map((m, i) => (
            <div key={`out-${m.year}-${m.month}`} className="min-w-0 px-1" style={{ flex: "0 0 50%" }}>
              {renderPane(m, computeMonthDays(m.year, m.month), `out${i}-`, rows)}
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
      // Three columns so the selector stays centred whatever the sides hold:
      // Today on the left (when the page offers it), the Duties toggle on the
      // right — one answer for every calendar and the roster's agenda.
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 px-1 pt-1 pb-0.5">
        <div className="flex justify-start">
          {onToday && (
            <button
              type="button"
              onClick={onToday}
              className="h-9 rounded-full px-3 text-xs font-semibold text-primary transition-colors hover:bg-[var(--on-glass-fill-soft)]"
            >
              Today
            </button>
          )}
        </div>
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
        <div className="flex justify-end">
          <button
            type="button"
            aria-pressed={showDuties}
            onClick={() => setCalendarDuties(!showDuties)}
            className={cn(
              "flex h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors",
              showDuties
                ? "bg-[var(--on-glass-active)] text-[var(--on-glass-active-fg)]"
                : "text-[var(--on-glass-muted)] hover:bg-[var(--on-glass-fill-soft)]"
            )}
          >
            <Layers className="h-3.5 w-3.5" aria-hidden />
            Duties
          </button>
        </div>
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
                    className="relative min-w-0 px-1 transition-opacity duration-150"
                    style={
                      {
                        flex: "0 0 50%",
                        // The picker sits over the right pane while it is up.
                        ...(isRightPane && view === "monthYear" ? { opacity: 0, visibility: "hidden" } : null),
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
    // In the dual layout the picker takes the right pane and the LEFT one
    // keeps showing the month being chosen; on a phone it takes the grid.
    const pickerBeside = dualMonth && view === "monthYear";
    const gridShown = view === "calendar" || pickerBeside;
    const activeContent = (
      <div className="relative" data-picker-beside={pickerBeside ? "" : undefined}>
        {/* The one date selector, above whichever view is showing — it is the
            control that opens and closes the picker, so it stays put (its
            chevron flips) rather than vanishing with the grid. */}
        {dateSelector}
        <div className="relative">
          {/* Calendar view — stays in FLOW under the picker, so the box keeps
              the day grid's height whichever view is up. */}
          <div
            aria-hidden={!gridShown}
            style={{
              opacity: gridShown ? 1 : 0,
              visibility: gridShown ? "visible" : "hidden",
              transition: "opacity 0.15s ease-in-out",
            }}
          >
            {calendarContent}
          </div>
          {/* Month/Year picker view — over the grid (or its right pane),
              filling that box. Mounted only while open: the wheels are
              ninety rows of 3D-transformed text. */}
          {view === "monthYear" && (
            <div
              className={cn(
                "absolute inset-y-0 right-0 animate-in fade-in-0 duration-150",
                pickerBeside ? "w-1/2" : "left-0"
              )}
            >
              {monthYearContent}
            </div>
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
