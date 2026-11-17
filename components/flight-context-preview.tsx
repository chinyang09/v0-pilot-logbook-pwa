"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import type { FlightLog } from "@/lib/db";
import { FlightCardBody } from "@/components/flight-card-body";
import { SignatureMark } from "@/components/signature-mark";
import { formatClockDisplay, formatHHMMDisplay } from "@/lib/utils/time";
import type { DisplayPreferences } from "@/types/db/stores.types";
import { setMenuOpen } from "@/lib/utils/menu-lock";
import { useBackDismiss } from "@/hooks/use-back-dismiss";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { POP_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  ACTION_LABEL_CLASS,
  ACTION_TILE_PX,
  actionTileClass,
  QUICK_ACTION_ITEMS,
  type FlightQuickAction,
} from "@/components/flight-quick-actions";

/**
 * The flight card's CONTEXT PREVIEW — a press-and-hold on a row lifts that one
 * card out of the list, shows the detail the compact card has no room for, and
 * puts the same action set beneath it.
 *
 * This is deliberately NOT the `…` cascade. The cascade is a menu: you know
 * what you want to do and go to a control that advertises itself. This is a
 * LOOK: you want to know more about one row without leaving your place, and a
 * hold is the gesture that has always meant "tell me about this".
 *
 * ── THE MORPH: a card that TRAVELS and is REVEALED, never scaled ──────────
 * The whole card — compact body, detail and all — is laid out ONCE, at its
 * resting size, from the first frame. Two things animate:
 *
 *   • its POSITION (`x`/`y`), from the held row to the middle of the screen;
 *   • a CLIP (`clip-path: inset(… round 12px)`) that starts as exactly the
 *     row — its height, its corners — and opens downward over the detail.
 *
 * So the first frame IS the row, to the pixel, and nothing is ever scaled:
 * no text squeezed, no border thinned, no corner stretched. It is the header
 * menus' technique (a clip from the control's own shape), which the owner
 * judged right, applied to the card.
 *
 * It replaced a `layout` projection (a FLIP), which the owner found unnatural
 * through several rounds of tuning, and the frames show why: a FLIP grows a
 * box by SCALE and counter-scales what is inside, so on the close the detail
 * faded at once and left the card a large EMPTY box being squashed, while the
 * compact body slid inside it on its own correction. A clip closing over a
 * card that keeps its size has nothing to distort.
 *
 * The card keeps the ROW's width, on a tablet too: widening it meant laying
 * the compact body out at the wider width, which a clip from the row would
 * cut off at the arrival time. A panel is a phone; its card stays a phone's.
 */
export interface PreviewAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MARGIN = 16;
/** The card's own corner (`rounded-xl`) — the clip keeps it at every frame. */
const CARD_RADIUS = 12;
const LIFT_SHADOW = "0px 25px 50px -12px rgba(0,0,0,0.45)";
/** The gap between the card and its action row. */
const GAP = 14;
/**
 * ONE spring for the travel and the reveal, so they are one motion. A touch
 * of give on the open (an iOS context menu's), none on the close: a card
 * going home should not bounce off its row.
 */
const OPEN = { type: "spring" as const, duration: 0.42, bounce: 0.12 };
const CLOSE = { type: "spring" as const, duration: 0.32, bounce: 0 };
const EASE = [0.32, 0.72, 0, 1] as const;
/**
 * The backdrop is a PLAIN DARKEN — no blur: a full-viewport backdrop-filter
 * recomputed on every frame the card travels was the one cost here big
 * enough to feel on a phone. Deeper than `MODAL_SCRIM`, because nothing else
 * separates the card from the list.
 */
const SCRIM = "bg-black/45 dark:bg-black/75";

/**
 * Day/night counts, written the way the card's chips write them (`1D`, `2N`)
 * so the two surfaces agree. A bare `2 / 1` would need the reader to know
 * which side is which.
 */
function dayNight(day?: number, night?: number): string {
  const parts: string[] = [];
  if (day) parts.push(`${day}D`);
  if (night) parts.push(`${night}N`);
  return parts.length ? parts.join(" / ") : "—";
}

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

  // Mounted only while shown: focus moves to its first action, Tab stays
  // inside, and it returns to whatever held it before the hold.
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true);
  const scrimPressRef = useRef(false);

  /**
   * The card's full height, read by a ResizeObserver (after the browser's own
   * layout, never mid-commit). Until it is known the card sits on the row,
   * clipped to it — identical to the row — so there is no blank frame.
   */
  const cardRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height;
      setHeight((prev) => (prev !== null && Math.abs(prev - h) < 0.5 ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The morph runs BOTH ways, so closing is a state the component passes
  // through rather than an unmount: back onto the row, then go.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  /** Fires once, whichever of the two paths below gets there first. */
  const finishClose = useCallback(() => {
    if (!closingRef.current) return;
    closingRef.current = false;
    closeRef.current();
  }, []);
  const startClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    // A safety net only: the card landing on its row (onAnimationComplete)
    // is what unmounts the overlay. A timer of exactly the close's length is
    // a frame or two EARLY — the row un-hid under a card still short of it.
    window.setTimeout(finishClose, 520);
  }, [finishClose]);

  // The system BACK gesture closes the preview instead of navigating out from
  // under it; everything else dismisses through `requestClose`, so an
  // action's `router.push` runs after the marker entry is released.
  const requestClose = useBackDismiss(true, startClose);

  // While the preview is up nothing behind it is a hit-test target.
  useEffect(() => {
    setMenuOpen(true);
    return () => setMenuOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  if (typeof document === "undefined") return null;

  const clock = (t?: string) => (t ? formatClockDisplay(t, displayPrefs?.clockSeparator) : "—");
  const dur = (t?: string) => (t && t !== "00:00" ? formatHHMMDisplay(t, displayPrefs?.timeFormat) : "—");

  const locked = !!flight.isLocked;
  const items = QUICK_ACTION_ITEMS(locked);
  const open = height !== null && !closing;

  // Where it comes to rest: the card and its action row centred together on
  // the screen, the card no taller than leaves room for the row.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxCard = vh - MARGIN * 2 - GAP - ACTION_TILE_PX;
  const restH = Math.min(height ?? anchor.height, maxCard);
  const restTop = Math.max(MARGIN, (vh - (restH + GAP + ACTION_TILE_PX)) / 2);
  const restLeft = (vw - anchor.width) / 2;
  const dx = restLeft - anchor.left;
  const dy = restTop - anchor.top;
  // The clip's bottom inset against the card's OWN height (`calc`), so the
  // row's box is exact whatever the card's height turns out to be — and the
  // open is the same template, so the two interpolate term by term.
  const rowClip = `inset(0px 0px calc(100% - ${anchor.height}px) 0px round ${CARD_RADIUS}px)`;
  const fullClip = `inset(0px 0px calc(0% - 0px) 0px round ${CARD_RADIUS}px)`;
  const motionT = closing ? CLOSE : OPEN;

  return createPortal(
    <div className="fixed inset-0 z-[210]">
      {/* Tapping anywhere off the card closes it — the preview is a look, so
          getting out of it should cost nothing. */}
      <motion.div
        className={cn("absolute inset-0", SCRIM)}
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: closing ? 0.24 : 0.3, ease: EASE }}
        // Only a tap that STARTED here dismisses: lifting the finger that
        // held the row can turn into a click on this scrim, which closed the
        // preview the moment it was let go.
        onPointerDown={() => {
          scrimPressRef.current = true;
        }}
        onClick={() => {
          if (scrimPressRef.current) requestClose();
          scrimPressRef.current = false;
        }}
      />

      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Flight preview" className="pointer-events-none absolute inset-0">
        {/* THE CARD — on the row, at the row's width, travelling with x/y. */}
        <motion.div
          className="pointer-events-auto fixed"
          style={{ left: anchor.left, top: anchor.top, width: anchor.width }}
          initial={{ x: 0, y: 0 }}
          animate={open ? { x: dx, y: dy } : { x: 0, y: 0 }}
          transition={motionT}
          onAnimationComplete={() => {
            if (closingRef.current) finishClose();
          }}
        >
          {/* The lift: OUTSIDE the clip (a clip cuts a shadow), and it arrives
              once the card is mostly open, leaves at once on the close. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: LIFT_SHADOW, borderRadius: CARD_RADIUS, height: restH }}
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={open ? { duration: 0.2, delay: 0.16, ease: EASE } : { duration: 0.08 }}
          />
          <motion.div
            ref={cardRef}
            className="relative overflow-y-auto overscroll-contain border border-border bg-card"
            style={{ borderRadius: CARD_RADIUS, maxHeight: maxCard }}
            initial={{ clipPath: rowClip }}
            animate={{ clipPath: open ? fullClip : rowClip }}
            transition={motionT}
          >
            <div className="px-3 py-1">
              <FlightCardBody flight={flight} displayPrefs={displayPrefs} />
            </div>

            {/* What the compact card has no room for. Always laid out (the
                clip reveals it); it rises in a beat behind the clip's edge on
                the open, and on the close it stays put while the clip closes
                over it — fading it first left an empty box collapsing. */}
            <motion.div
              className="px-4 py-2"
              initial={{ opacity: 0, y: -6 }}
              animate={open || closing ? { opacity: 1, y: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.3, delay: 0.08, ease: EASE }}
            >
              <div className="mb-2 border-t border-border/70" />
              {/* THE SIGNATURE FIRST, above everything it attests to. Absent
                  when unsigned — an empty strip would imply one is missing. */}
              {flight.signature ? (
                <div className="mb-2 border-b border-border/70 pb-2">
                  <SignatureMark signature={flight.signature} height={52} renderWidth={anchor.width - 32} />
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {flight.signature.signerName || "Signed"}
                      {flight.signature.signerRole ? (
                        <span className="ml-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                          {flight.signature.signerRole}
                        </span>
                      ) : null}
                    </span>
                    {flight.signature.signerLicenseNumber ? (
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                        {flight.signature.signerLicenseNumber}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-x-6">
                <Row label="Out" value={clock(flight.outTime)} />
                <Row label="Off" value={clock(flight.offTime)} />
                <Row label="On" value={clock(flight.onTime)} />
                <Row label="In" value={clock(flight.inTime)} />
                <Row label="Block" value={dur(flight.blockTime)} />
                <Row label="Flight" value={dur(flight.flightTime)} />
                <Row label="Night" value={dur(flight.nightTime)} />
                <Row label="IFR" value={dur(flight.ifrTime)} />
                <Row label="Role" value={flight.pilotRole || "—"} />
                <Row label="Reg" value={flight.aircraftReg || "—"} />
                <Row label="Take-off" value={dayNight(flight.dayTakeoffs, flight.nightTakeoffs)} />
                <Row label="Landing" value={dayNight(flight.dayLandings, flight.nightLandings)} />
              </div>

              {/* No PIC/SIC rows — the card body above already names the crew. */}
              {flight.remarks ? (
                <p className="mt-2 border-t border-border/70 pt-2 text-[13px] leading-snug text-muted-foreground">
                  {flight.remarks}
                </p>
              ) : null}
            </motion.div>
          </motion.div>
        </motion.div>

        {/* The actions, a row under the card's RESTING place. They do not
            travel: they pop in there as the card arrives, and on the close
            they go at once, before the card has moved far. Each button fades
            itself — a fading ancestor would be a backdrop root. */}
        <div
          className="pointer-events-auto fixed inset-x-0 flex items-start justify-center gap-2"
          style={{ top: restTop + restH + GAP, visibility: height === null ? "hidden" : undefined }}
        >
          {items.map((a, i) => (
            <motion.button
              key={a.id}
              type="button"
              // The action runs as the CLOSE's follow-up: most end in a
              // `router.push`, and the marker entry has to be released first.
              onClick={() => requestClose(() => onSelect(a.id))}
              aria-label={a.label}
              tabIndex={open ? 0 : -1}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={open ? { scale: 1, opacity: 1 } : { scale: 0.85, opacity: 0 }}
              transition={open ? { ...POP_SPRING, delay: 0.12 + i * 0.03 } : { duration: 0.1, ease: "easeOut" }}
              style={{ width: ACTION_TILE_PX, height: ACTION_TILE_PX, touchAction: "manipulation" }}
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
