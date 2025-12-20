"use client";

import type React from "react";

import {
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { FlightLog } from "@/lib/indexed-db";
import { cn } from "@/lib/utils";

interface LogbookCalendarProps {
  flights: FlightLog[];
  selectedMonth: { year: number; month: number };
  onMonthChange: (year: number, month: number) => void;
  onDateSelect?: (date: string) => void;
  selectedDate?: string | null;
  onScrollStart?: () => void;
  onInteractionEnd?: () => void;
}

export interface CalendarHandle {
  scrollToMonth: (year: number, month: number) => void;
}

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

export const LogbookCalendar = forwardRef<CalendarHandle, LogbookCalendarProps>(
  function LogbookCalendar(
    {
      flights,
      selectedMonth,
      onMonthChange,
      onDateSelect,
      selectedDate,
      onScrollStart,
      onInteractionEnd,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [swipeStartY, setSwipeStartY] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const isExternalScrollRef = useRef(false);
    const lastDetectedMonthRef = useRef<string | null>(null);

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
          dateStr: prevDate.toISOString().split("T")[0],
          isCurrentMonth: false,
        });
      }

      for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(selectedMonth.year, selectedMonth.month, i);
        days.push({
          date,
          dateStr: date.toISOString().split("T")[0],
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
          dateStr: nextDate.toISOString().split("T")[0],
          isCurrentMonth: false,
        });
      }

      return days;
    }, [selectedMonth]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToMonth: (year: number, month: number) => {
          // Set external flag BEFORE changing month
          isExternalScrollRef.current = true;
          onMonthChange(year, month);

          // Reset external flag after animation
          setTimeout(() => {
            isExternalScrollRef.current = false;
          }, 300);
        },
      }),
      [onMonthChange]
    );

    const handleTouchStart = (e: React.TouchEvent) => {
      setSwipeStartY(e.touches[0].clientY);
      setIsSwiping(true);
      if (!isExternalScrollRef.current) {
        onScrollStart?.();
      }
      e.stopPropagation();
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (!isSwiping) return;
      e.stopPropagation();
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
      if (!isSwiping) return;
      setIsSwiping(false);

      const diffY = swipeStartY - e.changedTouches[0].clientY;

      if (Math.abs(diffY) > 50) {
        let newYear = selectedMonth.year;
        let newMonth = selectedMonth.month;

        if (diffY > 0) {
          // Swipe up - next month
          newMonth = selectedMonth.month === 11 ? 0 : selectedMonth.month + 1;
          newYear =
            selectedMonth.month === 11
              ? selectedMonth.year + 1
              : selectedMonth.year;
        } else {
          // Swipe down - previous month
          newMonth = selectedMonth.month === 0 ? 11 : selectedMonth.month - 1;
          newYear =
            selectedMonth.month === 0
              ? selectedMonth.year - 1
              : selectedMonth.year;
        }

        const monthKey = `${newYear}-${newMonth}`;
        if (
          monthKey !== lastDetectedMonthRef.current &&
          !isExternalScrollRef.current
        ) {
          lastDetectedMonthRef.current = monthKey;
          onMonthChange(newYear, newMonth);
        }
      }

      onInteractionEnd?.();
    };

    const handleDateClick = (dateStr: string, hasFlights: boolean) => {
      if (hasFlights) {
        onDateSelect?.(dateStr);
      }
    };

    const today = new Date().toISOString().split("T")[0];

    return (
      <div
        className="flex flex-col h-full bg-gradient-to-b from-background via-background to-muted/20 touch-none"
        style={{ touchAction: "none" }}
      >
        <div className="grid grid-cols-7 gap-1 px-3 py-2 bg-muted/30 border-b border-border/50">
          {DAYS.map((day, i) => (
            <div
              key={i}
              className="text-center text-xs font-semibold text-muted-foreground/80 uppercase tracking-wide"
            >
              {day}
            </div>
          ))}
        </div>

        <div
          ref={containerRef}
          className="flex-1 px-3 py-2 overflow-hidden touch-none"
          style={{ contain: "layout", touchAction: "none" }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="grid grid-cols-7 grid-rows-6 gap-1.5 h-full">
            {calendarDays.map((dayInfo, dayIndex) => {
              const dateStr = dayInfo.dateStr;
              const flightInfo = flightDates.get(dateStr);
              const hasFlights = !!flightInfo;
              const isToday = dateStr === today;
              const isSelected = dateStr === selectedDate;
              const isCurrentMonth = dayInfo.isCurrentMonth;

              return (
                <button
                  key={dayIndex}
                  type="button"
                  onClick={() => handleDateClick(dateStr, hasFlights)}
                  disabled={!hasFlights}
                  className={cn(
                    "flex items-center justify-center text-sm rounded-lg relative transition-all duration-200 ease-out",
                    "transform-gpu will-change-transform",
                    hasFlights && "hover:scale-105 active:scale-95",
                    isCurrentMonth
                      ? "text-foreground font-medium"
                      : "text-muted-foreground/30 font-normal",
                    hasFlights &&
                      isCurrentMonth &&
                      "bg-primary/20 text-primary shadow-sm hover:shadow-md hover:bg-primary/30",
                    hasFlights &&
                      !isCurrentMonth &&
                      "bg-muted/30 text-muted-foreground/50",
                    flightInfo?.hasNight &&
                      isCurrentMonth &&
                      "bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/20",
                    isToday &&
                      "ring-2 ring-primary ring-offset-1 ring-offset-background",
                    isSelected &&
                      "!bg-primary !text-primary-foreground scale-105 shadow-lg",
                    !hasFlights && "cursor-not-allowed opacity-30"
                  )}
                >
                  <span className="relative z-10">
                    {dayInfo.date.getDate()}
                  </span>
                  {flightInfo && flightInfo.count > 1 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center shadow-md ring-1 ring-background">
                      {flightInfo.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);
