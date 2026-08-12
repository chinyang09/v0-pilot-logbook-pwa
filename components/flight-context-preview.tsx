"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { FlightLog } from "@/lib/db";
import { FlightCardBody } from "@/components/flight-card-body";
import { SignatureMark } from "@/components/signature-mark";
import { formatClockDisplay, formatHHMMDisplay } from "@/lib/utils/time";
import type { DisplayPreferences } from "@/types/db/stores.types";
import { setMenuOpen } from "@/lib/utils/menu-lock";
import { useBackDismiss } from "@/hooks/use-back-dismiss";
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
 *
 * ── THE MORPH ──────────────────────────────────────────────────────────────
 * The preview GROWS OUT OF the row you held, and goes back into it. It opens
 * as an exact copy of that card, sitting exactly where it sits in the list
 * (same `px-3 py-1` body, same `rounded-xl border bg-card`), then travels to
 * the centre while the detail and the action row unfurl beneath it.
 *
 * It comes to rest CENTRED ON THE VIEWPORT and as wide as the screen allows
 * (`MAX_WIDTH`) — a dialog held to the width of the panel it came out of barely
 * moves on a tablet. On a phone the row already fills the screen, so it rests
 * at the row's own width and the growth is all height (see `MIN_GROWTH`).
 *
 * ── IT IS A FLIP (framer's `layout` projection) ───────────────────────────
 *
 * This is the Shadix expandable-card technique, and it replaced a
 * hand-derived morph that animated `width` and two `height: 0 → auto` boxes.
 * The difference is structural rather than a matter of tuning: NOTHING here
 * animates a length any more. The card is laid out collapsed on one commit
 * (`position: fixed` on the row's own box) and expanded on the next (an
 * ordinary centred flex child at its natural height), and framer measures both
 * boxes and interpolates the difference as a transform. Per frame that is a
 * transform and some opacities.
 *
 * Two objections were held against this for a while, and both have answers:
 *
 *   • **"`layoutId` puts every virtualised row into framer's measurement
 *     pass."** True, and that is why there is no `layoutId` and the list is not
 *     involved at all. Shadix shares an id between a collapsed card and an
 *     expanded one; we already MEASURE the row (`anchor`) when the hold fires,
 *     so the collapsed box can be stated outright. Same projection, none of
 *     the cost — the logbook's rows stay plain.
 *   • **"FLIP animates the box by scale, so the text stretches."** Also true,
 *     and it is why every content block carries `layout="position"`. That makes
 *     each one its own projection node, which framer cancels the parent's scale
 *     on, so it animates where it SITS and never how big it is. One wrapper per
 *     block is enough — everything inside a corrected node is corrected with
 *     it. Shadix does exactly this on its title and description; our card is
 *     `tabular-nums` clock times, so it needs it more, not less.
 *
 * What is left:
 *
 *   • the CARD carries `layout` — the projection;
 *   • the compact body, the detail and the action row carry
 *     `layout="position"` — the scale correction;
 *   • the detail and the actions are MOUNTED only while open, inside
 *     `AnimatePresence`, so the card's natural height is what changes and the
 *     projection does the rest;
 *   • the lift is a static shadow on its own projected node (`LIFT_SHADOW`),
 *     faded by opacity — framer scale-corrects a box-shadow, which is why it
 *     can sit there rather than being interpolated as a string.
 *
 * Closing plays the same thing backwards, and the UNMOUNT is driven by the
 * card's own animation finishing rather than by a timer running beside it —
 * see `finishClose`.
 *
 * The backdrop is a plain darken with NO blur (`SCRIM`).
 */
export interface PreviewAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MARGIN = 16;
/** How wide the lifted card is allowed to GROW (Tailwind's `max-w-2xl`).
 *
 *  On anything bigger than a phone the row is the width of one panel, and
 *  expanding to a screen-centred card plainly bigger than the row IS the
 *  transformation. See the compact body's `layout` prop for how the projection
 *  is made to widen without clipping or crushing what is inside it. */
const MAX_WIDTH = 672;
/**
 * How much wider the card has to be able to GET before it grows sideways.
 *
 * A logbook row is `innerWidth - 2 x --panel-gutter` (24) and the wrapper's
 * margin would allow `innerWidth - 2 x MARGIN` (32), so on a phone "growing"
 * would mean the card getting 8px NARROWER. Below this threshold it rests at
 * the row's own width instead and there is no horizontal scale at all.
 *
 * 48px is about where a width change reads as the card growing rather than
 * twitching.
 */
const MIN_GROWTH = 48;
/**
 * The lift — a STATIC shadow on its own projected node, faded with `opacity`.
 *
 * It used to be an animated `boxShadow` on the card, which framer interpolates
 * by rebuilding the declaration string every frame for the browser to re-parse
 * and re-blur at 50px.
 *
 * It needs `layout` of its own even though it is `absolute inset-0`: without a
 * projection node the card's scale would squash a 50px blur along with
 * everything else. framer scale-corrects `boxShadow` and `borderRadius` on a
 * projected node, which is exactly what this needs and nothing else does.
 */
const LIFT_SHADOW = "0px 25px 50px -12px rgba(0,0,0,0.45)";
/** The gap between the card and its action row — inside the collapsing box, so
 *  it disappears with the row rather than holding the card off its mark. */
const GAP = 14;
/**
 * One clock for the whole morph, so the travel and the unfurl are one motion.
 * Ease-out with no overshoot: the card is arriving, not landing.
 *
 * 340 read as SNAPPY rather than smooth — the card had arrived before the eye
 * had finished following it, which makes an expansion feel like a cut. The
 * choreography below is expressed as fractions of this so the whole sequence
 * stretches together: retiming the box alone would leave the detail arriving
 * at the same absolute moment and the beat between them would go.
 */
const MORPH_MS = 460;
const MORPH = { duration: MORPH_MS / 1000, ease: [0.32, 0.72, 0, 1] as const };
/** The detail settles into the room the box just made — a beat after it. */
const DETAIL_DELAY = MORPH_MS * 0.3;
const DETAIL_MS = MORPH_MS * 0.76;
/**
 * The backdrop is a PLAIN DARKEN — no blur.
 *
 * It used to fade in `RadialBlurBackdrop`: three full-viewport
 * `backdrop-filter` layers, each sampling the output of the one below, so
 * while their opacity moved the whole stack was recomputed every frame — and
 * that landed on exactly the frames the card is travelling. It was already the
 * most expensive thing in this overlay by a wide margin (which is why it had
 * its own short clock rather than the morph's), and on a phone it is the one
 * cost here big enough to be felt on its own.
 *
 * Shadix's expandable card — the reference this morph was measured against —
 * uses a flat `bg-black/40` with no blur at all, and its `backdrop-blur-xs`
 * variant is commented out in its own source. That difference, not the morph
 * technique, was always the largest cost gap between the two.
 *
 * Deeper than the shared `MODAL_SCRIM` in both themes, because the blur was
 * carrying part of the separation and now nothing else is: a dialog keeps its
 * blur, this does not. ONE constant, so it is a single number to retune.
 */
const SCRIM = "bg-black/35 dark:bg-black/60";
/** The scrim is not part of the morph — it is just the lights going down. */
const SCRIM_FADE = { duration: 0.2, ease: [0.32, 0.72, 0, 1] as const };

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

  /**
   * The card is laid out COLLAPSED on the first commit and EXPANDED on the
   * next, and the flip between them is the whole animation.
   *
   * framer's `layout` measures a box before and after a real layout change and
   * interpolates the difference as a transform. It therefore needs two commits
   * with two different layouts — rendering the card in its final place on
   * mount gives it nothing to animate from. So: mount `position: fixed` on the
   * row's own box, then on the very next frame put it in the centred flex
   * column at its natural size.
   */
  const [expanded, setExpanded] = useState(false);
  // The morph runs BOTH ways, so closing is a state the component passes
  // through rather than an unmount: collapse back onto the row, then go.
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
    // Back to the collapsed layout — the same projection, run the other way.
    setExpanded(false);
    // A SAFETY NET, not the trigger — see onAnimationComplete on the card.
    // The animation only starts on the commit after this state change, so a
    // timer of exactly MORPH_MS is systematically a frame or two EARLY: the
    // overlay unmounted while the card was still a few pixels off the row and
    // the row un-hid underneath it, which is the flash on collapse. The extra
    // frames here mean this only ever fires if the animation never reports.
    window.setTimeout(finishClose, MORPH_MS + 120);
  }, [finishClose]);

  // The system BACK gesture closes the preview instead of navigating out from
  // under it. On Android that swipe is a history back, and with nothing of ours
  // on the stack it took the router to the previous page while this — portalled
  // to `document.body` — stayed up over it.
  //
  // Everything else dismisses through the returned `requestClose` so there is
  // exactly one close path; see the hook for why an action's `router.push` has
  // to wait for the marker entry to be released.
  const requestClose = useBackDismiss(true, startClose);

  // Same lock as the cascade: while the preview is up nothing behind it is a
  // hit-test target, so the list cannot be swiped or tapped through the scrim.
  useEffect(() => {
    setMenuOpen(true);
    return () => setMenuOpen(false);
  }, []);

  // The second commit — see `expanded`. A rAF rather than a plain effect so the
  // collapsed layout is actually PAINTED first; flipping in the effect body
  // lands in the same frame and framer has one box, not two.
  useEffect(() => {
    const id = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  if (typeof document === "undefined") return null;

  // `clockSeparator` punctuates a point in time; `timeFormat` writes a
  // DURATION. Two different settings — see the display-preferences note.
  const clock = (t?: string) =>
    t ? formatClockDisplay(t, displayPrefs?.clockSeparator) : "—";
  const dur = (t?: string) =>
    t && t !== "00:00" ? formatHHMMDisplay(t, displayPrefs?.timeFormat) : "—";

  const locked = !!flight.isLocked;
  const items = QUICK_ACTION_ITEMS(locked);
  const open = expanded && !closing;

  // It comes to rest CENTRED ON THE VIEWPORT and as wide as it is allowed to
  // grow — not in the row's own column. A dialog that stayed the width of the
  // panel it came from barely moved on a desktop, which is what made the morph
  // invisible there. It still OPENS at the row's own width and place, wherever
  // that is, so the first frame is the row to the pixel.
  const available = Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2);
  // Grow only where there is somewhere to grow to — see MIN_GROWTH. On a phone
  // there is not, so the card rests at exactly the ROW's width (not at
  // `available`, which is 8px narrower) and there is no horizontal scale at all.
  const width =
    available - anchor.width >= MIN_GROWTH ? available : anchor.width;
  // Nothing else to derive. The travel used to be computed by hand — the delta
  // between the row's box and where a centred flex column would put the
  // collapsed card — because the card was moved with `x`/`y`. The projection
  // measures both boxes itself, so those numbers are gone.

  return createPortal(
    <div className="fixed inset-0 z-[210]">
      {/* Tapping anywhere off the card closes it — the preview is a look, so
          getting out of it should cost nothing. */}
      <motion.div
        className={cn("absolute inset-0", SCRIM)}
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={SCRIM_FADE}
        // Wrapped, not passed directly — the handler's MouseEvent would
        // otherwise arrive as `requestClose`'s follow-up action.
        onClick={() => requestClose()}
      />

      {/* The positioning wrapper is `pointer-events-none` and only the card and
          the action row take pointers back.
          It spans nearly the whole screen so that the card can be centred — and
          with pointers on, that box swallowed almost every tap meant for the
          scrim. On a phone, where there is barely any scrim left uncovered,
          that meant the preview could not be dismissed at all. */}
      <div
        role="dialog"
        aria-label="Flight preview"
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        // Vertical only. The card carries the ROW's width, which is already
        // wider than this margin would allow — see `width`.
        style={{ paddingTop: MARGIN, paddingBottom: MARGIN }}
      >
        {/* THE CARD.
            `layout` is the whole technique: framer measures this box before and
            after the layout change below and interpolates the difference as a
            TRANSFORM. Collapsed it is `position: fixed` on the row's own box —
            so the first frame is the row, to the pixel, as it always was — and
            expanded it is an ordinary centred flex child at its natural height.
            Nothing here animates a length. */}
        <motion.div
          layout
          className="pointer-events-auto relative"
          // EVERY key in both states, never a switch between two different
          // shapes of object. A `motion` component does not clear a style
          // property that simply disappears from the object — measured: with
          // the collapsed branch dropping `position`/`top`/`left`/`height`,
          // those stayed on the element as `position: fixed; top: 12px;
          // left: 12px; height: 104.75px` for the whole morph, so the card
          // never left the row and there was no layout change to animate.
          style={{
            position: open ? "relative" : "fixed",
            top: open ? "auto" : anchor.top,
            left: open ? "auto" : anchor.left,
            width: open ? width : anchor.width,
            height: open ? "auto" : anchor.height,
          }}
          transition={MORPH}
          // The card landing back on its row is what "closed" MEANS, so it is
          // what unmounts the overlay — not a timer running alongside it.
          onLayoutAnimationComplete={() => {
            if (closing) finishClose();
          }}
        >
          {/* The lift. Its own node so framer scale-corrects the shadow rather
              than letting the card's projection squash a 50px blur, and so the
              only thing animating on it is an opacity.

              It sits OUTSIDE the clip below, because a box-shadow paints beyond
              the element's own box and `overflow: hidden` on an ancestor takes
              all of it. That is the whole reason this wrapper and the surface
              are two elements rather than one. */}
          <motion.div
            layout
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-xl"
            style={{ boxShadow: LIFT_SHADOW }}
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={MORPH}
          />

          {/* The card's surface, and the clip. Collapsed, the wrapper above
              carries an explicit height (the row's), so this is pinned to it —
              the detail is still mounted while it exits and would otherwise
              spill straight out of the collapsing box. Expanded, the wrapper's
              height comes from this, so the percentage is dropped. */}
          <div
            className="relative overflow-hidden rounded-xl border border-border bg-card"
            style={{ height: open ? undefined : "100%" }}
          >
            {/* FULL `layout` here, `layout="position"` on every block below,
                and that difference is what lets the card widen at all.

                The card's projection scales its subtree on BOTH axes: from a
                105px row to a ~500px card, and on a tablet from a 336px row to
                a 672px one. The VERTICAL part would crush this row's text to a
                fifth of its height and must be cancelled. The HORIZONTAL part
                is the card widening, which this content is meant to follow.

                `layout="position"` cancels both. That is right for a block
                which only exists while open, but for this one it would lay the
                body out at the RESTING width from the first frame and let the
                card clip it — so on a tablet the arrival time and ICAO would
                simply be missing until the card had widened past them.

                Full `layout` gives this its own projection node with its own
                delta. Its height is 103 in both states, so that delta is
                scaleX ONLY: the row's content is horizontally condensed at the
                first frame and relaxes out as the card widens, with no vertical
                distortion and nothing hidden. Condensed type reads as motion;
                half the flight missing reads as broken. */}
            <motion.div layout className="px-3 py-1">
              <FlightCardBody flight={flight} displayPrefs={displayPrefs} />
            </motion.div>

            {/* What the compact card has no room for. Mounted only while open, so
                the card's NATURAL height is the thing that changes and the
                projection does the rest — where this used to animate its own
                `height` from 0 to auto every frame. */}
            <AnimatePresence>
              {open ? (
                <motion.div
                  key="detail"
                  layout="position"
                  className="px-4 py-2"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{
                    duration: DETAIL_MS / 1000,
                    ease: [0.32, 0.72, 0, 1],
                    delay: DETAIL_DELAY / 1000,
                  }}
                >
                  <div className="mb-2 border-t border-border/70" />
                  {/* THE SIGNATURE FIRST, above everything it attests to.
                        A signed entry is a statement about the flight, so the mark
                        and who made it come before the figures rather than being
                        filed at the bottom with the remarks. Absent when unsigned —
                        an empty signature strip would imply one is missing. */}
                    {flight.signature ? (
                      <div className="mb-2 border-b border-border/70 pb-2">
                        {/* Backed at the card's RESTING content width (the detail's
                            `px-4` either side), not whatever the box is mid-morph —
                            the card's width animates, and a bitmap painted at the
                            opening width would be upscaled by the time it settles. */}
                        <SignatureMark
                          signature={flight.signature}
                          height={52}
                          renderWidth={width - 32}
                        />
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

                    {/* No PIC/SIC rows — the card body above already names the
                        crew, so repeating them here was the one part of the detail
                        that said nothing new. */}
                    {flight.remarks ? (
                      <p className="mt-2 border-t border-border/70 pt-2 text-[13px] leading-snug text-muted-foreground">
                        {flight.remarks}
                      </p>
                    ) : null}
                  </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* The actions, as a row beneath the card. In flow, so the flex column
            centres the card and the actions together and the card's projection
            carries the shift — no height animation here either. */}
        <AnimatePresence>
          {open ? (
            <motion.div
              key="actions"
              layout="position"
              className="pointer-events-auto flex items-start justify-center gap-2"
              style={{ paddingTop: GAP }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DETAIL_MS / 1000, ease: [0.32, 0.72, 0, 1] }}
            >
              {items.map((a, i) => (
                <motion.button
                  key={a.id}
                  type="button"
                  // The action runs as the CLOSE's follow-up, not before it.
                  // Most of these end in a `router.push` (Next Leg opens the
                  // flight it just created), and the marker history entry has
                  // to be released first or our own `back()` would undo it.
                  onClick={() => requestClose(() => onSelect(a.id))}
                  aria-label={a.label}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.4, opacity: 0 }}
                  transition={{ ...POP_SPRING, delay: 0.08 + i * 0.03 }}
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
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>,
    document.body
  );
}
