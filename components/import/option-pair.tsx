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
        // A licence-record choice: the unselected side stays READABLE (it is
        // the value the pilot may want back), and each side is a real target.
        "flex min-h-9 flex-1 flex-col justify-center rounded-md text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary",
        size === "sm" ? "px-2 py-1" : "px-2.5 py-1.5",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <span
        className={cn(
          "block uppercase leading-none tracking-wide",
          "text-[10px]",
          active ? "opacity-80" : "opacity-70"
        )}
      >
        {side.caption}
      </span>
      <span
        className={cn(
          "block font-semibold leading-tight",
          size === "sm" ? "text-xs" : "text-sm"
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
