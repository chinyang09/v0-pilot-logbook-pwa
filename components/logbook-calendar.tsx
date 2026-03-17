"use client";

import type React from "react";

import {
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { FlightLog } from "@/lib/db";
import { cn } from "@/lib/utils";

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
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [swipeStartY, setSwipeStartY] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [hasTriggeredSwipeStart, setHasTriggeredSwipeStart] = useState(false);
    const isExternalScrollRef = useRef(false);

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

    const calendarDays = useMemo(() => {
      const firstDay = new Date(selectedMonth.year, selectedMonth.month, 1);
      const startDay = firstDay.getDay();
      const daysInMonth = new Date(
        selectedMonth.year,
        selectedMonth.month + 1,
        0
      ).getDate();

      const days: { date: Date; dateStr: string; isCurrentMonth: boolean }[] =
        [];

      for (let i = 0; i < startDay; i++) {
        const prevDate = new Date(
          selectedMonth.year,
          selectedMonth.month,
          -(startDay - i - 1)
        );
        days.push({
          date: prevDate,
          dateStr: formatDateLocal(prevDate),
          isCurrentMonth: false,
        });
      }

      for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(selectedMonth.year, selectedMonth.month, i);
        days.push({
          date,
          dateStr: formatDateLocal(date),
          isCurrentMonth: true,
        });
      }

      const remainingDays = 42 - days.length;
      for (let i = 1; i <= remainingDays; i++) {
        const nextDate = new Date(
          selectedMonth.year,
          selectedMonth.month + 1,
          i
        );
        days.push({
          date: nextDate,
          dateStr: formatDateLocal(nextDate),
          isCurrentMonth: false,
        });
      }

      return days;
    }, [selectedMonth]);

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

    const handleDateClick = (dateStr: string, hasFlights: boolean) => {
      if (hasFlights) {
        onDateSelect?.(dateStr);
      }
    };

    const today = getTodayLocal();

    return (
      <div
        className={cn("flex flex-col w-full pb-0 overflow-hidden", className)}
      >
        {/* HEADER: Days of the week */}
        <div className="grid grid-cols-7 gap-0 px-1 pt-0.5 pb-0">
          {DAYS.map((day, i) => (
            <div
              key={i}
              className="text-center text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider"
            >
              {day}
            </div>
          ))}
        </div>

        {/* GRID: The actual month days */}
        <div
          ref={containerRef}
          className="flex-1 px-1 py-0 overflow-hidden touch-none"
          style={{ contain: "layout", touchAction: "none" }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
        >
          <div className="grid grid-cols-7 gap-0">
            {calendarDays.map((dayInfo, dayIndex) => {
              const flightInfo = flightDates.get(dayInfo.dateStr);
              const isCurrentMonth = dayInfo.isCurrentMonth;
              const isToday = dayInfo.dateStr === today;
              const isSelected = dayInfo.dateStr === selectedDate;

              return (
                <button
                  key={dayIndex}
                  onClick={() => handleDateClick(dayInfo.dateStr, !!flightInfo)}
                  className="flex items-center justify-center aspect-square p-px"
                >
                  <div
                    className={cn(
                      "w-full aspect-square flex items-center justify-center text-lg rounded-full transition-all",
                      isCurrentMonth
                        ? "text-foreground/90"
                        : "text-foreground/15",
                      flightInfo && isCurrentMonth && !isSelected && "font-semibold text-primary bg-primary/20",
                      isToday && "ring-1.5 ring-primary/60",
                      isSelected && "bg-primary text-primary-foreground shadow-md z-10"
                    )}
                  >
                    {dayInfo.date.getDate()}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);
