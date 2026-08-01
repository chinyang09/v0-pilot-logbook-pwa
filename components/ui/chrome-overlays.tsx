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

/** The main panel header's gradient, anchored to the fading edge. */
function fadeFor(side: Side): string {
  const to = side === "top" ? "bottom" : "top";
  return [
    `linear-gradient(to ${to}`,
    `var(--background) 0`,
    `var(--background) calc(100% - ${FADE}px)`,
    `color-mix(in srgb, var(--background) 60%, transparent) calc(100% - ${FADE / 2}px)`,
    `transparent 100%)`,
  ].join(", ");
}

/**
 * The progressive blur under the fade: heaviest at the anchored edge, gone by
 * the far end. Ordered smallest-radius-first with decreasing coverage so each
 * layer fully covers the ones below wherever it is opaque — the stack can
 * then only ADD blur and the ramp stays monotonic on both engines (see
 * SIDEBAR_BACKDROP_BLUR in nav-pill for the same rule).
 */
const BLUR_LAYERS: Array<{ blur: number; coverage: string; ramp: string }> = [
  { blur: 2.5, coverage: "100%", ramp: "45%" },
  { blur: 6, coverage: "72%", ramp: "42%" },
  { blur: 12, coverage: "48%", ramp: "42%" },
];

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
      style={{ ...anchor, height: "100%" }}
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
