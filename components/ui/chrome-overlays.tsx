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
 * Weighted to the reference the owner supplied (iOS's own layered headers, as
 * in the GitHub app): heavy at the anchored edge — 88% of the background — so
 * the bar clearly reads as chrome rather than as a slightly tinted strip, then
 * falling away over the tail. It is still NEVER fully solid: content passing
 * beneath has to survive as a legible ghost, or the band reads as the app
 * stopping at the status bar, which is the web-page-in-a-frame look the
 * edge-to-edge work removed. In the reference you can still make out the title
 * under the bar, and you can here.
 *
 * The direction is handled for free — `--background` IS the theme, so this
 * darkens on the dark theme and lightens on the light one with no branch.
 */
function fadeFor(side: Side): string {
  const to = side === "top" ? "bottom" : "top";
  return [
    `linear-gradient(to ${to}`,
    `color-mix(in srgb, var(--background) 88%, transparent) 0`,
    `color-mix(in srgb, var(--background) 74%, transparent) calc(100% - ${FADE}px)`,
    `color-mix(in srgb, var(--background) 34%, transparent) calc(100% - ${FADE / 2}px)`,
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
 * Weighted so the band reads as chrome you cannot reach through, which is the
 * job it was failing: at a 2.4px peak a card scrolling under the action
 * buttons still looked sharp and tappable, and the owner's read was that it
 * "blurs a little later" than a native bar and is misleading. Raised twice —
 * it peaks at 22px now, matched against the reference headers the owner
 * supplied, where the content under the bar is a soft wash with its shapes
 * still readable but nothing in it looking touchable.
 */
const BLUR_LAYERS: Array<{ blur: number; coverage: string; ramp: string }> = [
  { blur: 3, coverage: "100%", ramp: "62%" },
  { blur: 9, coverage: "80%", ramp: "48%" },
  { blur: 22, coverage: "54%", ramp: "40%" },
];

/**
 * How far the treatment extends BEYOND the bar it sits on.
 *
 * The band used to be exactly the bar's height, so the blur only really
 * arrived in the last few pixels above the buttons and a card sitting just
 * under them looked sharp, reachable and tappable — it was neither. Native
 * bars start softening well before their own edge, which is the cue that
 * says "this is behind the chrome". Anything that positions content against
 * the header should clear `--chrome-clear`, which is the bar PLUS this.
 */
const FADE_TAIL = 34;

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
 */
export function RadialBlurBackdrop({ className }: { className?: string }) {
  const layers: Array<{ blur: number; stop: number }> = [
    { blur: 2, stop: 100 },
    { blur: 6, stop: 72 },
    { blur: 14, stop: 48 },
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
            }}
          />
        );
      })}
    </div>
  );
}
