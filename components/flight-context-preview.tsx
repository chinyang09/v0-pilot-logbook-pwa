"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import type { FlightLog } from "@/lib/db";
import { FlightCardBody } from "@/components/flight-card-body";
import { MODAL_SCRIM, RadialBlurBackdrop } from "@/components/ui/chrome-overlays";
import { formatClockDisplay, formatHHMMDisplay } from "@/lib/utils/time";
import type { DisplayPreferences } from "@/types/db/stores.types";
import { setMenuOpen } from "@/lib/utils/menu-lock";
import { cn } from "@/lib/utils";
import {
  QUICK_ACTION_ITEMS,
  type FlightQuickAction,
} from "@/components/flight-quick-actions";

/**
 * The flight card's CONTEXT PREVIEW — a press-and-hold on a row lifts that one
 * card out of the list, enlarges it, and shows the detail the compact card has
 * no room for, with the same action set alongside.
 *
 * This is deliberately NOT the `…` cascade, and the distinction is the whole
 * point of having both. The cascade is a menu: you already know what you want
 * to do and you go and do it, from a control that advertises itself in the
 * swipe panel. This is a LOOK: you are scanning the list, you want to know more
 * about one row without leaving your place, and a hold is the gesture that has
 * always meant "tell me about this". The actions come along because once you
 * are looking at it, acting on it is the obvious next thing.
 *
 * A hold on a row inside a virtualised scroller was a fight the last time it
 * drove the actions menu, and the lessons are kept (see `flight-list`): the
 * hold cancels on any real movement, and firing it ENDS the card's pointer
 * session so framer cannot carry a half-started drag into the overlay.
 */
export interface PreviewAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MARGIN = 16;
const GAP = 14;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-[13px] font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function FlightContextPreview({
  flight,
  anchor,
  displayPrefs,
  onSelect,
  onClose,
}: {
  flight: FlightLog;
  anchor: PreviewAnchor;
  displayPrefs?: DisplayPreferences;
  onSelect: (action: FlightQuickAction) => void;
  onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Same lock as the cascade: while the preview is up nothing behind it is a
  // hit-test target, so the list cannot be swiped or tapped through the scrim.
  useEffect(() => {
    setMenuOpen(true);
    return () => setMenuOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (typeof document === "undefined") return null;

  // `clockSeparator` punctuates a point in time; `timeFormat` writes a
  // DURATION. Two different settings — see the display-preferences note.
  const clock = (t?: string) =>
    t ? formatClockDisplay(t, displayPrefs?.clockSeparator) : "—";
  const dur = (t?: string) =>
    t && t !== "00:00" ? formatHHMMDisplay(t, displayPrefs?.timeFormat) : "—";

  const locked = !!flight.isLocked;
  const items = QUICK_ACTION_ITEMS(locked);

  // The lifted card keeps the row's own width so it reads as THAT row rather
  // than a new panel; only its height and the detail below it are new.
  const width = Math.min(anchor.width, window.innerWidth - MARGIN * 2);
  const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN));

  return createPortal(
    <div className="fixed inset-0 z-[210]">
      {/* Tapping anywhere off the card closes it — the preview is a look, so
          getting out of it should cost nothing. */}
      <motion.div
        className={cn("absolute inset-0", MODAL_SCRIM)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={() => closeRef.current()}
      >
        <RadialBlurBackdrop />
      </motion.div>

      <motion.div
        role="dialog"
        aria-label="Flight preview"
        className="absolute flex flex-col items-stretch"
        style={{ left, width, top: MARGIN, bottom: MARGIN, justifyContent: "center" }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.9 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* THE CARD, lifted. The same body the list draws, so the thing you
            held is recognisably the thing you are now looking at. */}
        {/* No inner scale on the body: it overflowed the card's own padding at
            the route's widest, and the lift is already carried by the scrim,
            the shadow and the detail that appears underneath. */}
        <div className="rounded-xl border border-border bg-card shadow-2xl">
          <div className="px-3 py-2">
            <FlightCardBody flight={flight} displayPrefs={displayPrefs} />
          </div>

          <div className="mx-4 border-t border-border/70" />

          {/* What the compact card has no room for. */}
          <div className="px-4 py-2">
            <div className="grid grid-cols-2 gap-x-6">
              <Row label="Out" value={clock(flight.outTime)} />
              <Row label="Off" value={clock(flight.offTime)} />
              <Row label="On" value={clock(flight.onTime)} />
              <Row label="In" value={clock(flight.inTime)} />
              <Row label="Block" value={dur(flight.blockTime)} />
              <Row label="Flight" value={dur(flight.flightTime)} />
              <Row label="Night" value={dur(flight.nightTime)} />
              <Row label="Reg" value={flight.aircraftReg || "—"} />
            </div>
            {flight.remarks ? (
              <p className="mt-2 border-t border-border/70 pt-2 text-[13px] leading-snug text-muted-foreground">
                {flight.remarks}
              </p>
            ) : null}
          </div>
        </div>

        {/* The actions, as a row beneath the card — the same set and the same
            circles as the `…` cascade, laid out horizontally because here there
            is a whole screen's width and no button to cascade out of. */}
        <div className="mt-[14px] flex items-start justify-between gap-1" style={{ marginTop: GAP }}>
          {items.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onSelect(a.id);
                closeRef.current();
              }}
              aria-label={a.label}
              className="group flex flex-1 flex-col items-center gap-1 select-none"
            >
              <span
                className={cn(
                  "flex h-[46px] w-[46px] items-center justify-center rounded-full",
                  "border border-border bg-card text-foreground shadow-xl",
                  "transition-colors group-active:bg-secondary"
                )}
              >
                {a.icon}
              </span>
              <span className="rounded-full border border-border/60 bg-card px-1.5 py-[3px] text-[10px] font-medium leading-none text-foreground shadow-md">
                {a.label}
              </span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
