/**
 * Glass segmented tabs — the import dialog's bucket switcher.
 *
 * Built on `GlassContainer` so it reads as the same material as the nav pill
 * and the floating action buttons, rather than as loose chips. The active
 * segment is marked by a sliding indicator driven by a CSS `transform`
 * transition (compositor-driven — the same reason the nav's gravity blob
 * avoids a JS spring).
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassContainer } from "@/components/ui/glass-container";

export interface SegmentedTab<T extends string> {
  value: T;
  label: string;
  count?: number;
}

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
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(
    null
  );
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const measure = useCallback(
    (active: string) => {
      const el = buttons.current.get(active);
      if (!el) return;
      setIndicator((prev) =>
        prev && prev.x === el.offsetLeft && prev.w === el.offsetWidth
          ? prev
          : { x: el.offsetLeft, w: el.offsetWidth }
      );
    },
    []
  );

  // Re-measure whenever a segment mounts or resizes; the active value is read
  // at callback time so the indicator follows selection without an effect.
  const registerButton = useCallback(
    (tabValue: string) => (node: HTMLButtonElement | null) => {
      if (!node) {
        buttons.current.delete(tabValue);
        return;
      }
      buttons.current.set(tabValue, node);
      const ro = new ResizeObserver(() => measure(value));
      ro.observe(node);
      measure(value);
    },
    [measure, value]
  );

  return (
    <GlassContainer cornerRadius={22}>
      <div
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
              ref={registerButton(tab.value)}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.value)}
              className={cn(
                "relative z-10 shrink-0 rounded-full px-3 py-1.5 text-xs font-medium",
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
    </GlassContainer>
  );
}
