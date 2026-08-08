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
const ICON = "h-5 w-5";
/**
 * ONE WORD each, INSIDE the tile with its icon.
 *
 * The icons are AEROPLANES, distinguished by ATTITUDE — the reference set the
 * owner asked these to match. A plain plane repeated three times was tried and
 * rejected for exactly the obvious reason ("next leg", "return trip" and
 * "duplicate" are all flights, so three identical planes distinguish nothing),
 * and a relational set (an arrow, a two-way arrow, a stack) was tried instead.
 * The attitude answers both: they are unmistakably flights AND they differ.
 *
 *   next leg   nose UP, leaving      — the onward departure
 *   return     nose DOWN, coming back — the reverse leg
 *   repeat     LEVEL, unqualified     — another one like this
 *
 * "Copy" is deliberately not the word for that last one. It reads as putting
 * something on the clipboard, which is not what happens — a whole new flight
 * is created. "Repeat" says another INSTANCE.
 */
const ACTIONS: { id: FlightQuickAction; label: string; icon: React.ReactNode }[] = [
  { id: "next-leg", label: "Next", icon: <PlaneTakeoff className={ICON} /> },
  { id: "return-trip", label: "Return", icon: <PlaneLanding className={ICON} /> },
  { id: "duplicate", label: "Repeat", icon: <Plane className={ICON} /> },
  { id: "share", label: "Share", icon: <Share className={ICON} /> },
];

/**
 * ONE definition of an action button, shared by the cascade and the context
 * preview — and it is the SWIPE PANEL's button, not a shape of its own.
 *
 * The cascade comes out of the `…` in that panel, so anything else made the run
 * read as a different family of control appearing next to it: `rounded-lg` at
 * `BUTTON_WIDTH` (64) in `bg-secondary`, with the icon over a `text-xs` label,
 * is what a swipe action already looks like (`swipeable-card.tsx`). The one
 * addition is a shadow, because unlike a swipe button these FLOAT over the
 * list rather than sitting inside a row.
 *
 * Square rather than the swipe button's full row height: the cascade is a
 * COLUMN, and five row-height tiles is most of a screen.
 */
export const ACTION_TILE_PX = 64;
export const actionTileClass = cn(
  "flex flex-col items-center justify-center gap-0.5 rounded-lg overflow-hidden",
  "bg-secondary text-foreground shadow-lg select-none",
  "transition-colors active:bg-muted"
);
export const ACTION_LABEL_CLASS = "text-xs font-medium leading-none";

/** The `…` button's box, in viewport coordinates. */
export interface QuickActionAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ITEM_HEIGHT = ACTION_TILE_PX;
const ITEM_WIDTH = ACTION_TILE_PX;
/** The swipe panel's own gap, so the run is spaced like the buttons it leaves. */
const GAP = 8;
const MARGIN = 12;
/** Each button leaves the `…` a beat after the one before it. */
const STAGGER_MS = 38;

/**
 * The one action set, shared with the context preview
 * (`flight-context-preview.tsx`) so the two surfaces can never drift apart.
 */
export function QUICK_ACTION_ITEMS(
  locked: boolean
): { id: FlightQuickAction; label: string; icon: React.ReactNode }[] {
  return [
    ...ACTIONS,
    {
      id: "lock",
      label: locked ? "Unlock" : "Lock",
      icon: locked ? <Unlock className={ICON} /> : <Lock className={ICON} />,
    },
  ];
}

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

  const items = QUICK_ACTION_ITEMS(!!flight.isLocked);

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

  // CENTRED on the `…` it comes from — the run should read as growing out of
  // that button, and a column offset to one side of its own trigger reads as
  // belonging to something else. Clamped so a card near the panel edge still
  // puts the run fully on screen.
  const centre = anchor.left + anchor.width / 2;
  const left = Math.min(
    Math.max(centre - ITEM_WIDTH / 2, MARGIN),
    window.innerWidth - ITEM_WIDTH - MARGIN
  );

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
              // `group` so the circle can carry the pressed state for the whole
              // item (the tap target is the circle PLUS its caption).
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
              style={{
                width: ACTION_TILE_PX,
                height: ACTION_TILE_PX,
                touchAction: "manipulation",
              }}
              className={actionTileClass}
            >
              {a.icon}
              <span className={ACTION_LABEL_CLASS}>{a.label}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
