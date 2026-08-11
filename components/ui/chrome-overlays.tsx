/**
 * Overlay helpers for floating chrome and modal backdrops.
 *
 * `ChromeFade` is THE floating-header treatment — the main panel, the detail
 * panel and the mobile detail overlay all render it directly (see
 * `components/desktop-layout.tsx`), so changing it changes every header at
 * once. It is a native-style bar: a progressive BLUR (stacked masked layers,
 * smallest radius first and widest coverage so the stack only ever adds blur
 * toward the edge) under the darkening background gradient — content
 * scrolling beneath frosts out and dims the way it does under an iOS
 * navigation bar, and the anchored band visually holds during a rubber-band
 * so the bounce reads as starting below the header instead of at the screen
 * edge.
 */

"use client";

import { cn } from "@/lib/utils";

type Side = "top" | "bottom";

/**
 * Height of the fade itself. The main panel's header is a 64px bar carrying
 * the whole 0% → 60% → transparent ramp, so 64px IS that curve — anchoring to
 * it keeps taller chrome (a title + tab row) identical at the boundary instead
 * of stretching the ramp until cards show through the title.
 */
const FADE = 64;

/**
 * The main panel header's gradient, anchored to the fading edge.
 *
 * Weighted against the reference (iOS's own layered headers, as in the GitHub
 * app) with ONE correction that is easy to miss: an installed iOS PWA already
 * gets Apple's own `black-translucent` treatment over the status-bar strip, so
 * whatever this paints STACKS on top of it. Matching the reference's apparent
 * darkness by eye in a browser therefore overshoots badly once installed —
 * which is exactly what happened at 88%: on device the content under the bar
 * was unreadable, where in the reference you can still make out the title.
 *
 * 66% at the anchored edge is that reference MINUS what iOS contributes.
 *
 * The direction is handled for free — `--background` IS the theme, so this
 * darkens on the dark theme and lightens on the light one with no branch.
 */
function fadeFor(side: Side): string {
  const to = side === "top" ? "bottom" : "top";
  return [
    `linear-gradient(to ${to}`,
    `color-mix(in srgb, var(--background) 66%, transparent) 0`,
    `color-mix(in srgb, var(--background) 56%, transparent) calc(100% - ${FADE}px)`,
    `color-mix(in srgb, var(--background) 26%, transparent) calc(100% - ${FADE / 2}px)`,
    `transparent 100%)`,
  ].join(", ");
}

/**
 * The progressive blur under the fade: heaviest at the anchored edge, gone by
 * the far end. Ordered smallest-radius-first with decreasing coverage so each
 * layer fully covers the ones below wherever it is opaque — the stack can
 * then only ADD blur and the ramp stays monotonic on both engines (see
 * SIDEBAR_BACKDROP_BLUR in nav-pill for the same rule).
 *
 * The band has to read as chrome you cannot reach through — at the original
 * 2.4px peak a card scrolling under the action buttons still looked sharp and
 * tappable. Going the other way is the easier mistake to make, though, and it
 * was made twice: 22px, then 11px. Both were judged from the BOTTOM of the
 * band, which is the part these layers barely touch.
 *
 * The number that matters is the one at the TOP — the status-bar strip, where
 * all three layers overlap AND iOS is already applying its own. Sequential
 * blurs compose as the root-sum-square, so the peak here is not the largest
 * radius but √(Σr²), and reading the largest radius instead is what kept this
 * being set too high: 12.2px at 2/5/11, then still 6.0px at 2/3.2/4.6.
 *
 * At **0.6 / 1 / 1.4** the stack peaks at **1.8px** and the bottom of the band
 * is 0.6px — a tenth of where this started, and deliberately almost nothing.
 * This is a DARKEN-led treatment (see the veil above): the veil is what makes
 * the band read as chrome, and the blur's only job is to take the crispness
 * off an edge so it does not look touchable. Every round that judged the blur
 * by how much it HID was tuning the wrong layer.
 */
const BLUR_LAYERS: Array<{ blur: number; coverage: string; ramp: string }> = [
  { blur: 0.6, coverage: "100%", ramp: "60%" },
  { blur: 1, coverage: "76%", ramp: "46%" },
  { blur: 1.4, coverage: "46%", ramp: "36%" },
];

/**
 * How far the treatment extends BEYOND the bar it sits on.
 *
 * The band used to be exactly the bar's height, so the blur only really
 * arrived in the last few pixels above the buttons and a card sitting just
 * under them looked sharp, reachable and tappable — it was neither. Native
 * bars start softening well before their own edge, which is the cue that
 * says "this is behind the chrome": the band should be well clear of the
 * buttons before it starts climbing toward the top of the screen, so the
 * darkening reads as one continuous field rather than as something that
 * begins at the buttons' edge.
 *
 * This is the VISUAL band only. `--chrome-clear` — where the quick-scroll rail
 * parks a row — is deliberately LARGER: a row landing exactly on the band's
 * lower edge sits against it, and the point of the target is that the row is
 * clear of the treatment, not level with the end of it. The two were briefly
 * held equal and that pushed the darkening much too far down the screen.
 *
 * 41px puts the band's bottom 45px below the action buttons (34 gave 38).
 * Apple does not publish a figure for the scroll-edge effect's falloff, so
 * this is the owner's read on device rather than a spec number.
 */
const FADE_TAIL = 41;

export function ChromeFade({
  side,
  className,
}: {
  side: Side;
  className?: string;
}) {
  const anchor = side === "top" ? { top: 0 } : { bottom: 0 };
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0 z-0", className)}
      // Taller than the bar by FADE_TAIL — see the note there.
      style={{ ...anchor, height: `calc(100% + ${FADE_TAIL}px)` }}
    >
      {BLUR_LAYERS.map(({ blur, coverage, ramp }) => {
        const mask = `linear-gradient(to ${side}, transparent 0, black ${ramp})`;
        return (
          <div
            key={blur}
            className="absolute inset-x-0"
            style={{
              ...anchor,
              height: coverage,
              backdropFilter: `blur(${blur}px)`,
              WebkitBackdropFilter: `blur(${blur}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
      <div className="absolute inset-0" style={{ background: fadeFor(side) }} />
    </div>
  );
}

/**
 * Backdrop scrim for a full-app modal. `bg-black/50` reads fine over a dark
 * app but turns a light theme (white panels, glass sidebar) into grey mush —
 * so the veil is much lighter in light mode and leans on the blur instead.
 */
export const MODAL_SCRIM = "bg-black/15 dark:bg-black/50";

/**
 * Radial progressive blur for a modal backdrop: heaviest right around the
 * dialog, clearing toward the edges of the screen so the app stays legible
 * behind it.
 *
 * ── FADING THIS IS NOT THE SAME AS FADING ITS PARENT ──────────────────────
 *
 * `opacity`/`transition` are applied to EACH LAYER, never to a wrapper, and
 * that is a correctness requirement rather than a style choice. Per the Filter
 * Effects spec, an element with `opacity` below 1 — or `will-change: opacity`,
 * or a mask, or a filter — becomes a **backdrop root**, and a descendant's
 * `backdrop-filter` can then only sample content *inside* that root. Wrap these
 * layers in something that fades and they sample an empty backdrop: no blur at
 * all for the whole fade, then the full stack snapping on the instant
 * opacity reaches exactly 1. That is what a caller who fades a wrapper gets,
 * and it reads as a hitch at the end of the animation rather than as a fade.
 *
 * An element's OWN opacity is fine — the backdrop root is an *ancestor*
 * boundary, so each layer still samples the real page and merely composites at
 * that alpha. `SIDEBAR_BACKDROP_BLUR` in `nav-pill.tsx` has always been built
 * this way; this is the same rule.
 *
 * Callers that don't fade (the dialogs, which put this in `backdropSlot` as a
 * SIBLING of the overlay Radix fades) can ignore both props.
 */
export function RadialBlurBackdrop({
  className,
  /** 0–1, applied per layer. See the backdrop-root note above. */
  opacity = 1,
  /** CSS transition for that opacity, e.g. `opacity 340ms ease`. */
  transition,
}: {
  className?: string;
  opacity?: number;
  transition?: string;
}) {
  /**
   * THREE layers, not four.
   *
   * Each one samples the output of the one below it, so the cost of the stack
   * is not additive — it is a chain, and on a weak mobile GPU a fourth
   * full-viewport link is the one that shows. The ramp is what reads as depth
   * (a single radius reads as a flat frosted sheet), and three stops still
   * describe a ramp; the dropped stop was the 6px, whose neighbours are close
   * enough on either side to carry it. The end radii are unchanged, so the
   * heaviest and lightest parts of the field look the same.
   */
  const layers: Array<{ blur: number; stop: number }> = [
    { blur: 2, stop: 100 },
    { blur: 10, stop: 60 },
    { blur: 26, stop: 28 },
  ];
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      {layers.map(({ blur, stop }) => {
        const mask = `radial-gradient(ellipse 70% 60% at 50% 50%, black 0%, black ${stop * 0.4}%, transparent ${stop}%)`;
        return (
          <div
            key={blur}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${blur}px)`,
              WebkitBackdropFilter: `blur(${blur}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
              opacity,
              transition,
            }}
          />
        );
      })}
    </div>
  );
}
