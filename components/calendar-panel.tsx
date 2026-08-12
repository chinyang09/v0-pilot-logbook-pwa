"use client"

/**
 * THE floating calendar panel — one presentation, used by the logbook and the
 * dashboard.
 *
 * Both pages were already rendering `LogbookCalendar`; what made them look like
 * different calendars was everything AROUND it. The logbook had a collapsing
 * height panel across the full panel width, the calendar rendered transparent
 * inside the glass, a 20px radius, dual-month where the layout allows, and the
 * month/year picker opened from the calendar's own header. The dashboard had a
 * spring-in floating card capped at `max-w-md`, a 24px radius, its own glass,
 * no dual month, and a second month label in the ACTION BAR — the exact thing
 * the logbook removed for saying the same thing twice.
 *
 * So the wrapper lives here rather than in either page, and a page supplies
 * only what genuinely differs: the logbook picks a single date, the dashboard
 * picks a range.
 *
 * ── Why the calendar is always MOUNTED ──────────────────────────────────────
 *
 * Collapsed to `height: 0` rather than conditionally rendered, so its natural
 * height is always measurable and the collapse is a plain px transition. The
 * logbook's flight list reserves that exact height in its top spacer and runs
 * it on the SAME `PANEL_MOTION` string, so the panel opening and the list being
 * pushed are one movement instead of two curves side by side. `onNaturalHeight`
 * is what feeds that.
 */

import * as React from "react"

import { LogbookCalendar, type CalendarHandle } from "@/components/logbook-calendar"
import { MONTH_PANE_PX } from "@/lib/layout/panel-widths"
import { MORPH_EASE } from "@/lib/motion"

/** ONE clock for the panel and anything reserving space for it. */
export const PANEL_MS = 300
export const PANEL_MOTION = `height ${PANEL_MS}ms ${MORPH_EASE}`

type CalendarProps = React.ComponentProps<typeof LogbookCalendar>

export interface CalendarPanelProps
  extends Omit<
    CalendarProps,
    "className" | "glass" | "cornerRadius" | "paneMaxWidth" | "view" | "headerActive"
  > {
  /** Open state. The panel is mounted either way — see the note above. */
  open: boolean
  /** Show the month/year picker instead of the day grid. */
  monthYearView?: boolean
  /**
   * Reported whenever the content's natural height changes, so a caller can
   * reserve exactly this much (the logbook's list spacer).
   */
  onNaturalHeight?: (height: number) => void
  /**
   * Split layout — a month is then always ONE PANE wide, so the calendar is the
   * same height with one month as with two and the width toggle stops resizing
   * whatever sits under it. A phone has no dual mode to match, so it keeps the
   * full-width default.
   */
  splitLayout?: boolean
}

export const CalendarPanel = React.forwardRef<CalendarHandle, CalendarPanelProps>(
  function CalendarPanel(
    { open, monthYearView = false, onNaturalHeight, splitLayout, ...calendar },
    ref,
  ) {
    const contentRef = React.useRef<HTMLDivElement>(null)
    const [naturalHeight, setNaturalHeight] = React.useState(0)

    // Measured, not guessed: the height depends on how many week rows the month
    // has and on whether one pane or two are showing.
    React.useEffect(() => {
      const el = contentRef.current
      if (!el) return
      const observer = new ResizeObserver(() => {
        const h = el.offsetHeight
        setNaturalHeight((prev) => {
          if (prev === h) return prev
          onNaturalHeight?.(h)
          return h
        })
      })
      observer.observe(el)
      return () => observer.disconnect()
    }, [onNaturalHeight])

    return (
      <div
        className="overflow-hidden"
        style={{
          height: open ? naturalHeight : 0,
          transition: PANEL_MOTION,
          willChange: "height",
        }}
        aria-hidden={!open}
      >
        <div ref={contentRef} className="px-2 pb-2">
          <LogbookCalendar
            ref={ref}
            // Transparent INSIDE the panel's glass — the surrounding surface is
            // the material, so the calendar must not paint a second one.
            className="bg-transparent shadow-none border-none"
            glass
            cornerRadius={20}
            paneMaxWidth={splitLayout ? MONTH_PANE_PX : undefined}
            view={monthYearView ? "monthYear" : "calendar"}
            headerActive={monthYearView}
            {...calendar}
          />
        </div>
      </div>
    )
  },
)
