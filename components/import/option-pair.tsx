/**
 * Two-option chooser used wherever an import disagrees with what's already
 * logged: our calculation vs the company's, your recorded value vs theirs.
 *
 * The selected side is lit in the accent colour; the other dims out. That
 * reads as a choice at a glance, where a strike-through only read as "one of
 * these is crossed out" without saying which one wins.
 */

"use client";

import { cn } from "@/lib/utils";

export interface OptionPairSide {
  /** Small caption above the value, e.g. "Calculated" / "Company". */
  caption: string;
  /** The value itself, e.g. "Night" / "PF". */
  value: string;
}

function OptionSide({
  side,
  active,
  isRight,
  size,
  onChange,
}: {
  side: OptionPairSide;
  active: boolean;
  isRight: boolean;
  size: "sm" | "md";
  onChange?: (rightActive: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={!onChange}
      onClick={(e) => {
        // The card is a <label>; a click here must not toggle its checkbox.
        e.preventDefault();
        e.stopPropagation();
        onChange?.(isRight);
      }}
      className={cn(
        "flex-1 rounded-md text-left transition-colors",
        size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground/45 hover:text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "block uppercase leading-none tracking-wide",
          size === "sm" ? "text-[8px]" : "text-[9px]",
          active ? "opacity-70" : "opacity-60"
        )}
      >
        {side.caption}
      </span>
      <span
        className={cn(
          "block font-semibold leading-tight",
          size === "sm" ? "text-[10px]" : "text-[11px]"
        )}
      >
        {side.value}
      </span>
    </button>
  );
}

export function OptionPair({
  left,
  right,
  /** Which side is active — `false` = left, `true` = right. */
  rightActive,
  onChange,
  className,
  size = "md",
}: {
  left: OptionPairSide;
  right: OptionPairSide;
  rightActive: boolean;
  onChange?: (rightActive: boolean) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "flex shrink-0 gap-0.5 rounded-lg bg-muted/40 p-0.5",
        className
      )}
    >
      <OptionSide
        side={left}
        active={!rightActive}
        isRight={false}
        size={size}
        onChange={onChange}
      />
      <OptionSide
        side={right}
        active={rightActive}
        isRight
        size={size}
        onChange={onChange}
      />
    </div>
  );
}
