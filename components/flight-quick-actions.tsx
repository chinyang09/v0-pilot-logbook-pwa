"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Lock, Plane, PlaneLanding, PlaneTakeoff, Share, Unlock } from "lucide-react";
import type { FlightLog } from "@/lib/db";
import { cn } from "@/lib/utils";
import { POP_SPRING } from "@/lib/motion";
import { setMenuOpen } from "@/lib/utils/menu-lock";

export type FlightQuickAction = "next-leg" | "return-trip" | "duplicate" | "share" | "lock";

/**
 * The flight card's extra actions — Next Leg / Return Trip / Duplicate / Share
 * / Lock — cascading out of the `…` button in the row's swipe panel.
 *
 * This replaced a press-and-hold menu, and the reason is worth keeping: a hold
 * is an invisible gesture. Nothing on the card said it was there, it competed
 * with the swipe and the scroll for the same pointer, and holding a row while
 * the list is a virtualised scroller turned out to be a long fight with
 * whichever engine was delivering the events. The swipe panel is already the
 * card's "what can I do to this" surface and it is already discoverable, so
 * these belong in it: `[…] [delete]`.
 *
 * They are NOT a popover. Each option is its own button, the same shape as the
 * swipe buttons they come out of, and they travel out from the `…` one after
 * another — the panel growing rather than a dialog appearing over it. Rendered
 * through a PORTAL so the card's own size never changes: a menu that pushed
 * the list around would move every row below it.
 */
const ACTIONS: { id: FlightQuickAction; label: string; icon: React.ReactNode }[] = [
  { id: "next-leg", label: "Next Leg", icon: <PlaneTakeoff className="h-[18px] w-[18px]" /> },
  { id: "return-trip", label: "Return Trip", icon: <PlaneLanding className="h-[18px] w-[18px]" /> },
  { id: "duplicate", label: "Duplicate", icon: <Plane className="h-[18px] w-[18px]" /> },
  { id: "share", label: "Share", icon: <Share className="h-[18px] w-[18px]" /> },
];

/** The `…` button's box, in viewport coordinates. */
export interface QuickActionAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Wider than a swipe button (64) so "Return Trip" fits on one line. */
const ITEM_WIDTH = 78;
const ITEM_HEIGHT = 48;
const GAP = 8;
const MARGIN = 12;
/** Each button leaves the `…` a beat after the one before it. */
const STAGGER_MS = 38;

export function FlightQuickActions({
  flight,
  anchor,
  onSelect,
  onClose,
}: {
  flight: FlightLog;
  anchor: QuickActionAnchor;
  onSelect: (action: FlightQuickAction) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const locked = !!flight.isLocked;
  const items = [
    ...ACTIONS,
    {
      id: "lock" as const,
      label: locked ? "Unlock" : "Lock",
      icon: locked ? <Unlock className="h-[18px] w-[18px]" /> : <Lock className="h-[18px] w-[18px]" />,
    },
  ];

  // DOWN by default; UP only when the run would not fit below. DERIVED, not
  // state: the anchor is fixed for this cascade's whole life, so there is one
  // answer and it is known on the first render — no frame where the column
  // paints downward and then flips. (Safe to read `window` here: the cascade
  // only ever mounts from a tap, so it never server-renders.)
  const runHeight = items.length * ITEM_HEIGHT + (items.length - 1) * GAP + GAP;
  const dir: "down" | "up" =
    typeof window === "undefined" ||
    runHeight <= window.innerHeight - (anchor.top + anchor.height) - MARGIN
      ? "down"
      : "up";

  // Everything behind a cascade is untouchable for as long as it is up — see
  // lib/utils/menu-lock. The rows are the thing being acted on, so leaving them
  // operable would let a swipe or a tap land on the card the cascade belongs to.
  useEffect(() => {
    setMenuOpen(true);
    return () => setMenuOpen(false);
  }, []);

  /**
   * Open without freezing the app, and without letting anything behind it be
   * OPERATED. Identical to the rule the hold menu established, and kept for the
   * same reason: the line is between MOVING the app and ACTING on it, drawn at
   * `pointerdown` in the capture phase with `stopPropagation` and NOT
   * `preventDefault` — the event never reaches a React or framer handler, while
   * the browser's own compositor-driven scroll is untouched.
   */
  useEffect(() => {
    const inside = (t: EventTarget | null) => !!rootRef.current?.contains(t as Node);
    // The tap that OPENED this is still in flight: its click has not been
    // dispatched yet, and swallowing that one would close the cascade on the
    // same gesture that asked for it.
    let armed = false;
    const arm = () => {
      armed = true;
    };
    const armTimer = window.setTimeout(arm, 240);

    const block = (e: Event) => {
      if (inside(e.target)) return;
      e.stopPropagation();
    };
    const blockAndFocusGuard = (e: Event) => {
      if (inside(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const swallow = (e: Event) => {
      if (inside(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (armed) closeRef.current();
    };
    const dismissOnly = (e: Event) => {
      if (armed && !inside(e.target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };

    document.addEventListener("pointerdown", block, true);
    document.addEventListener("touchstart", block, true);
    document.addEventListener("mousedown", blockAndFocusGuard, true);
    document.addEventListener("click", swallow, true);
    document.addEventListener("pointerup", swallow, true);
    document.addEventListener("scroll", dismissOnly, { capture: true, passive: true });
    document.addEventListener("wheel", dismissOnly, { capture: true, passive: true });
    document.addEventListener("touchmove", dismissOnly, { capture: true, passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(armTimer);
      document.removeEventListener("pointerdown", block, true);
      document.removeEventListener("touchstart", block, true);
      document.removeEventListener("mousedown", blockAndFocusGuard, true);
      document.removeEventListener("click", swallow, true);
      document.removeEventListener("pointerup", swallow, true);
      document.removeEventListener("scroll", dismissOnly, true);
      document.removeEventListener("wheel", dismissOnly, true);
      document.removeEventListener("touchmove", dismissOnly, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (typeof document === "undefined") return null;

  // Right-aligned with the `…` it comes from, and clamped so a card near the
  // panel edge still puts the run fully on screen.
  const right = Math.min(
    Math.max(anchor.left + anchor.width, ITEM_WIDTH + MARGIN),
    window.innerWidth - MARGIN
  );
  const left = right - ITEM_WIDTH;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[200]">
      <div
        ref={rootRef}
        role="menu"
        aria-label="Flight actions"
        className="pointer-events-auto absolute"
        style={{
          left,
          width: ITEM_WIDTH,
          // Anchored to the `…`'s near edge; the buttons then travel away from
          // it in the chosen direction.
          top: dir === "up" ? undefined : anchor.top + anchor.height + GAP,
          bottom: dir === "up" ? window.innerHeight - anchor.top + GAP : undefined,
        }}
      >
        <div className={cn("flex flex-col gap-2", dir === "up" && "flex-col-reverse")}>
          {items.map((a, i) => (
            <motion.button
              key={a.id}
              type="button"
              role="menuitem"
              aria-label={a.label}
              onClick={() => {
                onSelect(a.id);
                onClose();
              }}
              // Each starts ON the `…` and travels to its slot, so the run
              // reads as coming OUT of the button rather than appearing.
              initial={{
                opacity: 0,
                scale: 0.5,
                y: (dir === "up" ? 1 : -1) * (i * (ITEM_HEIGHT + GAP) + GAP),
              }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ ...POP_SPRING, delay: (i * STAGGER_MS) / 1000 }}
              style={{ height: ITEM_HEIGHT, touchAction: "manipulation" }}
              className={cn(
                // The same rounded chip as a swipe action button, in the
                // grouped-row vocabulary (a bordered card, not glass — these
                // have to be READ, and glass over a list of cards is not).
                "flex w-full flex-col items-center justify-center gap-0.5 rounded-lg",
                "border border-border bg-card text-foreground shadow-xl select-none",
                "active:bg-secondary transition-colors"
              )}
            >
              {a.icon}
              <span className="text-[11px] font-medium leading-none">{a.label}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
