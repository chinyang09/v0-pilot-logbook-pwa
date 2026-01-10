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
  onSwipeStart?: () => void;
  onInteractionEnd?: () => void;
  className?: string;
}

export interface CalendarHandle {
  scrollToMonth: (year: number, month: number) => void;
}

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

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

    const handleDateClick = (dateStr: string, hasFlights: boolean) => {
      if (hasFlights) {
        onDateSelect?.(dateStr);
      }
    };

    const today = getTodayLocal();

    return (
      <div
        className={cn("flex flex-col bg-transparent w-full pb-4", className)}
      >
        {/* HEADER: Days of the week */}
        <div className="grid grid-cols-7 gap-1 px-4 py-3">
          {DAYS.map((day, i) => (
            <div
              key={i}
              className="text-center text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest"
            >
              {day}
            </div>
          ))}
        </div>

        {/* GRID: The actual month days */}
        <div
          ref={containerRef}
          className="flex-1 px-3 py-2 overflow-hidden touch-none"
          style={{ contain: "layout", touchAction: "none" }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map((dayInfo, dayIndex) => {
              const flightInfo = flightDates.get(dayInfo.dateStr);
              const isCurrentMonth = dayInfo.isCurrentMonth;
              const isToday = dayInfo.dateStr === today;
              const isSelected = dayInfo.dateStr === selectedDate;

              return (
                <button
                  key={dayIndex}
                  onClick={() => handleDateClick(dayInfo.dateStr, !!flightInfo)}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl text-sm transition-all relative",
                    // Only show current month days clearly
                    isCurrentMonth
                      ? "text-foreground font-semibold"
                      : "text-foreground/10 font-normal",
                    // If there are flights, give it a subtle "button" look
                    flightInfo &&
                      isCurrentMonth &&
                      "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(var(--primary),0.1)]",
                    // High contrast for selected/today
                    isToday && "ring-2 ring-primary ring-offset-1",
                    isSelected &&
                      "bg-primary! text-primary-foreground! scale-105 shadow-lg z-10"
                  )}
                >
                  <span>{dayInfo.date.getDate()}</span>
                  {/* Tiny dot for flights instead of a big badge to keep it clean */}
                  {flightInfo && isCurrentMonth && !isSelected && (
                    <div className="absolute bottom-1.5 w-1 h-1 rounded-full bg-primary" />
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
