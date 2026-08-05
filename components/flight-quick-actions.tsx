"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Plane, PlaneLanding, PlaneTakeoff, Share, Unlock } from "lucide-react";
import type { FlightLog } from "@/lib/db";
import { MODAL_SCRIM } from "@/components/ui/chrome-overlays";
import { cn } from "@/lib/utils";

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
 */
const ACTIONS: { id: FlightQuickAction; label: string; icon: React.ReactNode }[] = [
  { id: "next-leg", label: "Next Leg", icon: <PlaneTakeoff className="h-5 w-5" /> },
  { id: "return-trip", label: "Return Trip", icon: <PlaneLanding className="h-5 w-5" /> },
  { id: "duplicate", label: "Duplicate", icon: <Plane className="h-5 w-5" /> },
  { id: "share", label: "Share", icon: <Share className="h-5 w-5" /> },
];

/** Where the menu should appear, in viewport coordinates. */
export interface QuickActionAnchor {
  x: number;
  y: number;
}

const MENU_WIDTH = 244;
const MARGIN = 12;

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

  // Placed after mount so the menu's real height is known — it has to flip
  // above the finger near the bottom of the screen rather than hang off it.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(MARGIN, anchor.x - MENU_WIDTH / 2), window.innerWidth - MENU_WIDTH - MARGIN);
    const below = anchor.y + 12;
    const top = below + h > window.innerHeight - MARGIN ? Math.max(MARGIN, anchor.y - h - 12) : below;
    setPlaced({ left, top });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Only ever rendered in response to a press, so `document` is there.
  if (typeof document === "undefined") return null;

  const locked = !!flight.isLocked;

  return createPortal(
    <div
      className="fixed inset-0 z-[200]"
      onPointerDown={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={cn("absolute inset-0", MODAL_SCRIM)} />
      <div
        ref={menuRef}
        role="menu"
        aria-label="Flight actions"
        className={cn(
          "absolute overflow-hidden rounded-2xl border border-border bg-popover shadow-xl",
          "origin-top animate-in fade-in zoom-in-95 duration-150"
        )}
        style={{
          width: MENU_WIDTH,
          left: placed?.left ?? -9999,
          top: placed?.top ?? -9999,
          // Hidden until placed, or it paints once at the anchor and jumps.
          visibility: placed ? "visible" : "hidden",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="menuitem"
            onClick={() => {
              onSelect(a.id);
              onClose();
            }}
            className="row-divider flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-base text-foreground transition-colors active:bg-secondary"
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
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-base text-foreground transition-colors active:bg-secondary"
        >
          <span>{locked ? "Unlock" : "Lock"}</span>
          <span className="text-muted-foreground">
            {locked ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </span>
        </button>
      </div>
    </div>,
    document.body
  );
}
