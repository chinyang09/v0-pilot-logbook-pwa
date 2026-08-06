"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Plane, PlaneLanding, PlaneTakeoff, Share, Unlock } from "lucide-react";
import type { FlightLog } from "@/lib/db";
import { cn } from "@/lib/utils";
import { setMenuOpen } from "@/lib/utils/menu-lock";

export type FlightQuickAction = "next-leg" | "return-trip" | "duplicate" | "share" | "lock";

/**
 * The press-and-hold menu on a flight card.
 *
 * Deliberately NOT the swipe panel: swiping is for the two destructive-ish
 * row actions (lock, delete) and stays a one-handed gesture, while these are
 * "make me another flight from this one" — a different kind of thing, and one
 * that wants naming rather than an icon. A hold is also the one gesture the
 * card had spare: tap opens the flight and a horizontal drag opens the swipe
 * panel, so the menu costs neither of them.
 *
 * It is built from the app's own GROUPED-ROW vocabulary — the same card,
 * radius and inset `.row-divider` as `FormSection`/`SettingsRow` — rather than
 * a generic popover. Deliberately NOT the glass: glass is for chrome floating
 * over content, and a menu has to be read. Tried as a glass slab, the flight
 * cards showed straight through the labels.
 */
const ACTIONS: { id: FlightQuickAction; label: string; icon: React.ReactNode }[] = [
  { id: "next-leg", label: "Next Leg", icon: <PlaneTakeoff className="h-[18px] w-[18px]" /> },
  { id: "return-trip", label: "Return Trip", icon: <PlaneLanding className="h-[18px] w-[18px]" /> },
  { id: "duplicate", label: "Duplicate", icon: <Plane className="h-[18px] w-[18px]" /> },
  { id: "share", label: "Share", icon: <Share className="h-[18px] w-[18px]" /> },
];

/**
 * The CARD's box, in viewport coordinates — not the finger's position.
 *
 * Anchoring to the finger meant the menu landed somewhere different every time
 * for the same row, which makes it feel like it appeared by accident. Anchored
 * to the card it is always in the same place relative to the thing it acts on,
 * so the eye knows where to go before it opens.
 */
export interface QuickActionAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MENU_WIDTH = 236;
const MARGIN = 12;
/** Space between the card and the menu. */
const GAP = 8;

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
  const menuRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Placed after mount so the menu's real height is known — it has to flip
  // above the card near the bottom of the screen rather than hang off it.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - MENU_WIDTH / 2),
      window.innerWidth - MENU_WIDTH - MARGIN
    );
    const below = anchor.top + anchor.height + GAP;
    const top =
      below + h > window.innerHeight - MARGIN
        ? Math.max(MARGIN, anchor.top - h - GAP)
        : below;
    setPlaced({ left, top });
  }, [anchor.left, anchor.top, anchor.width, anchor.height]);

  /**
   * Open the menu without freezing the app, and without letting anything
   * behind it be OPERATED.
   *
   * The distinction that matters is between *moving* and *acting*. Scrolling
   * is moving: the list should still slide under the menu and the menu goes
   * away with it, because a menu that pins the whole app reads as a modal, and
   * this is not one. Everything else is acting — opening a card, revealing its
   * swipe panel, focusing a field, hitting a button — and none of it should be
   * possible while the menu is up.
   *
   * That line is drawn at POINTERDOWN, in the capture phase, with
   * `stopPropagation` and NOT `preventDefault`:
   *
   * - `stopPropagation` means the event never reaches any React or
   *   framer-motion handler, so `SwipeableCard`'s drag never starts. A
   *   full-screen scrim was the obvious alternative and it is worse: it kills
   *   the scroll too.
   * - NOT calling `preventDefault` leaves the browser's own default — the
   *   compositor-driven touch scroll — untouched. That is the whole trick;
   *   scrolling is not delivered through the listeners we are cutting.
   *
   * `mousedown` additionally gets `preventDefault`, which is what stops a text
   * field taking focus on a desktop click (touch focus follows the click,
   * which is swallowed below anyway).
   */
  // Tell every SwipeableCard to drop its drag for as long as this is up. The
  // capture-phase block below should already make a drag impossible, and on
  // Chromium it demonstrably does — but a card still moved slightly on iOS,
  // and unbinding beats starving: with `drag={false}` there is no gesture for
  // any engine to feed. See lib/utils/menu-lock.
  useEffect(() => {
    setMenuOpen(true);
    return () => setMenuOpen(false);
  }, []);

  useEffect(() => {
    const inMenu = (t: EventTarget | null) => !!menuRef.current?.contains(t as Node);
    // The menu opens WHILE the finger is still down, so the lift that ends the
    // hold — and the click the browser may synthesise from it — belong to the
    // gesture that opened it. Both are swallowed (or the card underneath would
    // receive them) but neither closes: arming waits for that gesture to end.
    let armed = false;

    /** Stop the app seeing it, but leave the browser's scroll alone. */
    const block = (e: Event) => {
      if (inMenu(e.target)) return;
      e.stopPropagation();
    };
    const blockAndFocusGuard = (e: Event) => {
      if (inMenu(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const swallow = (e: Event) => {
      if (inMenu(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (armed) closeRef.current();
    };
    // Movement passes through untouched — the page scrolls as normal and the
    // menu simply goes with it.
    const dismissOnly = (e: Event) => {
      if (armed && !inMenu(e.target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    // Registered AFTER `swallow`, so `swallow` sees the opening lift first
    // (with `armed` still false). `stopPropagation` does not stop other
    // listeners on the same node, so this still runs.
    const armAfterOpeningGesture = () => {
      window.setTimeout(() => {
        armed = true;
      }, 0);
    };

    document.addEventListener("pointerdown", block, true);
    document.addEventListener("touchstart", block, true);
    document.addEventListener("mousedown", blockAndFocusGuard, true);
    document.addEventListener("click", swallow, true);
    document.addEventListener("pointerup", swallow, true);
    document.addEventListener("pointerup", armAfterOpeningGesture, { capture: true, once: true });
    // A hold released without a pointerup (cancelled by the OS) still has to
    // arm, or the menu could never be dismissed.
    const armFallback = window.setTimeout(() => {
      armed = true;
    }, 700);
    document.addEventListener("scroll", dismissOnly, { capture: true, passive: true });
    document.addEventListener("wheel", dismissOnly, { capture: true, passive: true });
    document.addEventListener("touchmove", dismissOnly, { capture: true, passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(armFallback);
      document.removeEventListener("pointerdown", block, true);
      document.removeEventListener("touchstart", block, true);
      document.removeEventListener("mousedown", blockAndFocusGuard, true);
      document.removeEventListener("click", swallow, true);
      document.removeEventListener("pointerup", swallow, true);
      document.removeEventListener("pointerup", armAfterOpeningGesture, true);
      document.removeEventListener("scroll", dismissOnly, true);
      document.removeEventListener("wheel", dismissOnly, true);
      document.removeEventListener("touchmove", dismissOnly, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (typeof document === "undefined") return null;

  const locked = !!flight.isLocked;

  const row =
    "row-divider flex w-full items-center justify-between gap-3 px-4 py-3 text-left " +
    "text-[15px] text-foreground transition-colors active:bg-secondary";

  return createPortal(
    // No scrim and no pointer-events: the page stays live underneath (see
    // above). `quick-menu-in` is a pure opacity keyframe — `animate-in` was
    // still carrying a translate, which is the "flying in" the owner saw.
    <div className="pointer-events-none fixed inset-0 z-[200]">
      <div
        ref={menuRef}
        role="menu"
        aria-label="Flight actions"
        className="quick-menu-in pointer-events-auto absolute"
        style={{
          width: MENU_WIDTH,
          left: placed?.left ?? -9999,
          top: placed?.top ?? -9999,
          // Hidden until placed, or it paints once at the anchor and jumps.
          visibility: placed ? "visible" : "hidden",
        }}
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onSelect(a.id);
                onClose();
              }}
              className={row}
            >
              <span>{a.label}</span>
              <span className="text-muted-foreground">{a.icon}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSelect("lock");
              onClose();
            }}
            className={cn(row, "[&.row-divider]:after:hidden")}
          >
            <span>{locked ? "Unlock" : "Lock"}</span>
            <span className="text-muted-foreground">
              {locked ? <Unlock className="h-[18px] w-[18px]" /> : <Lock className="h-[18px] w-[18px]" />}
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
