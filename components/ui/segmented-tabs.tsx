/**
 * Segmented tabs — THE segmented choice: the import dialogs' bucket
 * switcher, the Quick Check's mode, the discrepancy tabs, the add-aircraft
 * mode, and the custom palette's vividness and depth.
 *
 * On the ACTION SURFACE (`.control-surface`, the glass face's painted half),
 * so it reads as the same material as the header controls without carrying
 * the glass's backdrop-filters into every panel it sits in. The active
 * segment is marked by a sliding indicator driven by a CSS `transform`
 * transition (compositor-driven — the same reason the nav's gravity blob
 * avoids a JS spring).
 *
 * The segments are measured by ONE ResizeObserver, whose callback runs after
 * the browser's own layout. It used to read `offsetLeft` inside each segment's
 * ref callback — a forced layout in the middle of the commit — and, because
 * that callback was rebuilt whenever the selection changed, every tap
 * attached a fresh observer to every segment and never disconnected the old
 * ones. Measuring every segment on any change also covers the case a
 * per-segment observer misses: a count changing width shifts the segments
 * after it without resizing them.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedTab<T extends string> {
  value: T;
  label: string;
  count?: number;
}

type Boxes = Record<string, { x: number; w: number }>;

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: SegmentedTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const [boxes, setBoxes] = useState<Boxes>({});
  const listRef = useRef<HTMLDivElement>(null);

  const measureAll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const next: Boxes = {};
    for (const el of list.querySelectorAll<HTMLButtonElement>("[data-segment]")) {
      next[el.dataset.segment!] = { x: el.offsetLeft, w: el.offsetWidth };
    }
    setBoxes((prev) => {
      const keys = Object.keys(next);
      const same =
        keys.length === Object.keys(prev).length &&
        keys.every((k) => prev[k]?.x === next[k].x && prev[k]?.w === next[k].w);
      return same ? prev : next;
    });
  }, []);

  // Re-observed when the SET of segments changes (labels, counts), never on
  // a selection change — the indicator is derived from `boxes` at render.
  const segmentKey = tabs.map((t) => t.value).join("|");
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(measureAll);
    ro.observe(list);
    for (const el of list.querySelectorAll("[data-segment]")) ro.observe(el);
    return () => ro.disconnect();
  }, [segmentKey, measureAll]);

  const indicator = boxes[value];

  // The action surface, not the real glass: a segmented control sits in a
  // panel or a dialog over a flat backdrop, where a blur returns the backdrop
  // unchanged — and the glass's five backdrop-filters were re-rasterised on
  // every scroll frame of whatever moved under them (the import review).
  return (
    <div className="control-surface rounded-full">
      <div
        ref={listRef}
        role="tablist"
        className={cn(
          "relative flex items-center gap-0.5 overflow-x-auto scrollbar-hide p-1",
          className
        )}
      >
        {indicator && (
          <span
            aria-hidden
            className="absolute inset-y-1 left-0 rounded-full bg-[var(--on-glass-accent)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none"
            style={{
              width: indicator.w,
              transform: `translateX(${indicator.x}px)`,
            }}
          />
        )}
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              data-segment={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.value)}
              className={cn(
                // h-9: a segment is a thing a thumb has to hit. They were
                // `py-1.5` (~28px).
                // flex-1: the segments share the control's width, as a native
                // segmented control's do — content-sized, a full-width control
                // ended in an empty strip after the last one.
                "relative z-10 flex h-9 flex-1 shrink-0 items-center justify-center rounded-full px-3.5 text-xs font-medium whitespace-nowrap",
                "transition-colors active:scale-[0.97]",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "ml-1 tabular-nums",
                    active ? "text-primary" : "text-[var(--on-glass-muted)]"
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
