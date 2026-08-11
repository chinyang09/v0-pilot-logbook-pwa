"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
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
 * It comes to rest centred on the VIEWPORT at `MAX_WIDTH`, not in the column
 * the row lives in. That is what makes the transformation visible on anything
 * bigger than a phone: a dialog held to the width of the panel it came out of
 * barely moves. On a phone the row already fills the screen, so the width
 * clamps to what it had and the growth is all height — there is nowhere else
 * for it to go.
 *
 * It is NOT framer's shared-layout (`layoutId`) morph, and that is deliberate.
 * The source card lives inside a VIRTUALISED list: a `layout`/`layoutId` prop
 * there puts every rendered row into framer's measurement pass on every layout
 * change, which is exactly the per-row measuring the logbook list was rebuilt
 * to avoid (see the virtualised-list note in CLAUDE.md). A FLIP morph also
 * animates the box by SCALE, so the card's text would visibly stretch on the
 * way up — the growth here is nearly all height.
 *
 * Instead the geometry is derived, not measured, and nothing scales:
 *
 *   • the wrapper is a centred flex column, so with the detail and the actions
 *     collapsed to `height: 0` the card comes to rest at `(innerHeight −
 *     cardHeight) / 2`;
 *   • the card's opening `y` is the difference between that and the row's own
 *     top — so at the first frame it is over the row, to the pixel, with no
 *     measurement;
 *   • the detail and the actions animate their real `height` (0 → auto), and
 *     the flex centring re-centres the group frame by frame as they grow.
 *
 * Everything else is a TRANSFORM or an OPACITY, which framer hands to the
 * compositor. The two exceptions were removed rather than accepted: the card's
 * `width` is only animated where the card can actually grow (`MIN_GROWTH` —
 * on a phone it could not, and the reflow was pure cost), and the lift is a
 * static shadow on its own layer faded by opacity (`LIFT_SHADOW`) instead of
 * an interpolated `boxShadow` string. What is left on the main thread is the
 * two unfurling heights, which is what the nav morph animates too.
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
 *  The morph has to be visible, and on anything wider than a phone the row is
 *  the width of one panel — expanding to a screen-centred card that is plainly
 *  bigger than the row is the transformation. On a phone the row already fills
 *  the viewport, so this clamps to the same width it had and the growth is all
 *  height; there is nowhere else for it to go. */
const MAX_WIDTH = 672;
/**
 * How much wider the card has to be able to GET before its width is animated
 * at all.
 *
 * `width` is the ONE property in this morph that reflows the card's whole
 * subtree — the twelve-row grid, the signature canvas, the crew rows, the
 * remarks — on every frame. Everything else animated here is a transform, an
 * opacity, or the height of a box whose children do not depend on it.
 *
 * On a phone that reflow was being paid for NOTHING. A logbook row is
 * `innerWidth - 2 x --panel-gutter` (24) and this rests at
 * `innerWidth - 2 x MARGIN` (32), so the "growth" was the card getting 8px
 * NARROWER — invisible, unlike the cost of it. The note above already claimed
 * a phone "clamps to the width it had"; this is what makes that true.
 *
 * 48px is about where a width change starts reading as the card growing rather
 * than twitching. Below it, resting at the row's own width is both what it
 * looks like anyway and free.
 */
const MIN_GROWTH = 48;
/**
 * The lift — a STATIC shadow on its own layer, faded with `opacity`.
 *
 * It used to be an animated `boxShadow` on the card itself, from
 * `0 0 0 0 transparent` to this. framer interpolates a box-shadow by rebuilding
 * the declaration string every frame; the browser then re-parses it and
 * re-blurs a 50px shadow. That is main-thread work on exactly the frames the
 * card is travelling, and it was one of only two things left in this morph
 * that could not be handed to the compositor (the other is the unfurling
 * height, which has to stay).
 *
 * The layer is `absolute inset-0` inside the card's transform wrapper, so it
 * tracks the box to the pixel and only its opacity moves.
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
  const open = !closing;

  // It comes to rest CENTRED ON THE VIEWPORT and as wide as it is allowed to
  // grow — not in the row's own column. A dialog that stayed the width of the
  // panel it came from barely moved on a desktop, which is what made the morph
  // invisible there. It still OPENS at the row's own width and place, wherever
  // that is, so the first frame is the row to the pixel.
  const available = Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2);
  // Only grow if there is somewhere to grow TO — see MIN_GROWTH. On a phone
  // there is not, so the card rests at exactly the row's width and `width` is
  // left out of the animation entirely rather than animated from a value to
  // itself.
  const growsWider = available - anchor.width >= MIN_GROWTH;
  const width = growsWider ? available : anchor.width;
  const left = (window.innerWidth - width) / 2;
  const fromX = anchor.left - left;
  // Where the COLLAPSED card comes to rest in the centred wrapper — and so how
  // far it has to start above or below that to be sitting on its row.
  const collapsedTop = (window.innerHeight - anchor.height) / 2;
  const fromY = anchor.top - collapsedTop;

  return createPortal(
    <div className="fixed inset-0 z-[210]">
      {/* Tapping anywhere off the card closes it — the preview is a look, so
          getting out of it should cost nothing. */}
      <motion.div
        className={cn("absolute inset-0", SCRIM)}
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={MORPH}
        // Wrapped, not passed directly — the handler's MouseEvent would
        // otherwise arrive as `requestClose`'s follow-up action.
        onClick={() => requestClose()}
      />

      {/* The positioning wrapper is `pointer-events-none` and only the card and
          the action row take pointers back.
          It spans nearly the whole screen (top/bottom margins, the row's own
          width) so that the card can be centred — and with pointers on, that
          box swallowed almost every tap meant for the scrim. On a phone, where
          there is barely any scrim left uncovered, that meant the preview could
          not be dismissed at all. */}
      <div
        role="dialog"
        aria-label="Flight preview"
        className="pointer-events-none absolute flex flex-col items-stretch"
        style={{ left, width, top: MARGIN, bottom: MARGIN, justifyContent: "center" }}
      >
        {/* THE CARD, lifted — and at the first frame it is still the row: same
            surface, same `px-3 py-1` body, sitting on the row's own box. */}
        <motion.div
          className="pointer-events-auto relative"
          initial={{
            y: fromY,
            x: fromX,
            ...(growsWider ? { width: anchor.width } : null),
          }}
          animate={{
            y: open ? 0 : fromY,
            x: open ? 0 : fromX,
            ...(growsWider ? { width: open ? width : anchor.width } : null),
          }}
          transition={MORPH}
          // The card landing back on its row is what "closed" MEANS, so it is
          // what unmounts the overlay — not a timer running alongside it. The
          // timer was set to exactly MORPH_MS but the animation does not begin
          // until the commit after `closing` flips, so it always ran out with
          // the card still short of the row: the overlay disappeared, the row
          // un-hid a few pixels away, and that offset read as a flash.
          onAnimationComplete={() => {
            if (closing) finishClose();
          }}
        >
          {/* The lift, on its own layer so only an OPACITY animates — see
              LIFT_SHADOW. `inset-0` inside this transform wrapper makes it the
              card's box exactly; the shadow paints OUTSIDE that box, which is
              why the clipping moved down onto the surface below. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-xl"
            style={{ boxShadow: LIFT_SHADOW }}
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={MORPH}
          />
          {/* The card's own surface. It carries the clip, so the unfurling
              detail below is masked by the rounded box rather than by the
              wrapper the shadow needs to escape. */}
          <div className="relative overflow-hidden rounded-xl border border-border bg-card">
            <div className="px-3 py-1">
              <FlightCardBody flight={flight} displayPrefs={displayPrefs} />
            </div>

            {/* What the compact card has no room for — the part that UNFURLS.
                Real height, not a scale: the card's text must not stretch. */}
            <motion.div
              className="overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
              transition={MORPH}
            >
              <div className="mx-4 border-t border-border/70" />
              {/* The detail arrives a beat AFTER the box that holds it. The box
                  growing is the card changing shape; this is the content settling
                  into the room that just appeared, and separating the two is most
                  of what makes the expansion legible rather than a jump.

                  OPACITY AND TRANSFORM ONLY. This used to also animate
                  `filter: blur(4px) → blur(0px)`, which re-rasterises the whole
                  subtree every frame — a paint-bound animation running on exactly
                  the frames the card is travelling, for a softness you cannot
                  really see against text that is also moving. The `y` lift does
                  the same job for free. */}
              <motion.div
                className="px-4 py-2"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: open ? 1 : 0, y: open ? 0 : 10 }}
                transition={{
                  duration: DETAIL_MS / 1000,
                  ease: [0.32, 0.72, 0, 1],
                  delay: open ? DETAIL_DELAY / 1000 : 0,
                }}
              >
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
            </motion.div>
          </div>
        </motion.div>

        {/* The actions, as a row beneath the card — the same set and the same
            tiles as the `…` cascade, laid out horizontally because here there
            is a whole screen's width and no button to cascade out of.
            Its gap lives INSIDE the collapsing box (as padding), or a closed
            row would still hold the card 14px off its own mark. */}
        <motion.div
          className="pointer-events-auto overflow-hidden"
          initial={{ height: 0, opacity: 0, y: fromY }}
          animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0, y: open ? 0 : fromY }}
          transition={MORPH}
        >
          <div
            className="flex items-start justify-center gap-2"
            style={{ paddingTop: GAP }}
          >
            {items.map((a, i) => (
              <motion.button
                key={a.id}
                type="button"
                // The action runs as the CLOSE's follow-up, not before it.
                // Most of these end in a `router.push` (Next Leg opens the
                // flight it just created), and the marker history entry has to
                // be released first or our own `back()` would undo that push.
                onClick={() => requestClose(() => onSelect(a.id))}
                aria-label={a.label}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: open ? 1 : 0.4, opacity: open ? 1 : 0 }}
                transition={{ ...POP_SPRING, delay: open ? 0.08 + i * 0.03 : 0 }}
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
        </motion.div>
      </div>
    </div>,
    document.body
  );
}
