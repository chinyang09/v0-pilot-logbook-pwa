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
 * radius but √(Σr²): 12.2px at 2/5/11, which on device made everything above
 * the action buttons unreadable while the row level with them was only "a
 * little too much". At 2/3.2/4.6 the stack peaks at 6.0px and the bottom of
 * the band is unchanged at 2px — the part the owner signed off on. You can
 * read what is passing under the status bar; it is simply not crisp.
 */
const BLUR_LAYERS: Array<{ blur: number; coverage: string; ramp: string }> = [
  { blur: 2, coverage: "100%", ramp: "60%" },
  { blur: 3.2, coverage: "76%", ramp: "46%" },
  { blur: 4.6, coverage: "46%", ramp: "36%" },
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
