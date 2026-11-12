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
 * Height of the fade itself. The main panel's header is a 52px bar (plus the
 * status bar) carrying the whole ramp, so 52px IS that curve — anchoring to
 * it keeps taller chrome (a title + tab row) identical at the boundary instead
 * of stretching the ramp until cards show through the title.
 */
const FADE = 52;

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
 * ONE blur layer under the fade, not three.
 *
 * This used to be a three-layer ramp (0.6 / 1 / 1.4px, decreasing coverage),
 * which composes as the root-sum-square to a 1.8px peak at the top of the
 * band. The optics were right and the cost was not: a `backdrop-filter` is a
 * readback of everything behind the element plus a blur, re-rasterised
 * whenever the BACKDROP changes — which, for a header sitting over a scrolling
 * list, is every single scroll frame. Three of them, full width, on every
 * panel header in the app.
 *
 * A single 1.8px layer is the same peak for a third of the work. What is lost
 * is the RAMP — the band no longer softens gradually from its lower edge to
 * the status bar — and that is a fair trade here precisely because the numbers
 * are so small: the difference between 0.6px and 1.8px of blur is not
 * something you can see, where the difference between three backdrop readbacks
 * a frame and one is something you can feel.
 *
 * This is a DARKEN-led treatment (see the veil above). The veil is what makes
 * the band read as chrome; the blur's only job is to take the crispness off an
 * edge so it does not look touchable. Every round that judged the blur by how
 * much it HID was tuning the wrong layer.
 */
const FACE_BLUR = 1.8;
/** Where the single layer's own ramp reaches full strength. */
const BLUR_RAMP = "58%";

export function ChromeFade({ side, className }: { side: Side; className?: string }) {
  const anchor = side === "top" ? { top: 0 } : { bottom: 0 };
  const ramp = `linear-gradient(to ${side}, transparent 0, black ${BLUR_RAMP})`;
  return (
    <div
      aria-hidden
      // EXACTLY the bar's height, no tail below it: the band, the tap-to-top
      // target and the bar are one line (`--chrome-top`), with the action
      // buttons in the middle of it. A 16px tail (41 before that) put the
      // blur's edge below the buttons and the tap target's edge further still,
      // so neither said where the header ended — and the owner read the tap
      // area as too large. It also took every floating panel's top into the
      // treatment, which needed its own mask to clear.
      className={cn("pointer-events-none absolute inset-0 z-0", className)}
    >
      <div
        className="absolute inset-x-0"
        style={{
          ...anchor,
          height: "100%",
          backdropFilter: `blur(${FACE_BLUR}px)`,
          WebkitBackdropFilter: `blur(${FACE_BLUR}px)`,
          maskImage: ramp,
          WebkitMaskImage: ramp,
        }}
      />
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
 * Radial progressive DARKENING for a modal backdrop: heaviest right around the
 * dialog, clearing toward the edges of the screen so the app stays legible
 * behind it.
 *
 * It was a radial progressive BLUR — three full-viewport `backdrop-filter`
 * layers, each sampling the output of the one below. That is a chain rather
 * than a sum, and on a weak mobile GPU the whole stack recomputes whenever the
 * backdrop or its own opacity changes. A gradient does the same job for one
 * paint: the dialog separates from the page because the page is DARKER around
 * it, not because it is softer.
 *
 * Keeping the same ellipse and the same stops means the falloff is unchanged —
 * only what falls off is different.
 *
 * `opacity`/`transition` are still per LAYER rather than on a wrapper, because
 * a caller that fades this wants a composited fade and a wrapper would add a
 * stacking layer for nothing. (The backdrop-root hazard that used to make this
 * mandatory is gone with the filter, but the shape is worth keeping: it is one
 * element either way.)
 */
export function RadialBlurBackdrop({
  className,
  /** 0–1. */
  opacity = 1,
  /** CSS transition for that opacity, e.g. `opacity 340ms ease`. */
  transition,
}: {
  className?: string;
  opacity?: number;
  transition?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        background:
          "radial-gradient(ellipse 70% 60% at 50% 50%, var(--modal-scrim-core) 0%, var(--modal-scrim-core) 24%, transparent 68%)",
        opacity,
        transition,
      }}
    />
  );
}
