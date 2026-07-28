/**
 * Overlay helpers for floating chrome and modal backdrops.
 *
 * `ChromeFade` is the SAME treatment the main panel and detail panel use for
 * their floating header (see `components/desktop-layout.tsx`): a single
 * background gradient — solid at the edge, 60% at the midpoint, transparent at
 * the far end — and no `backdrop-filter` at all. Content scrolls under it and
 * fades out; nothing is blurred, nothing steps.
 *
 * An earlier version here stacked masked blur layers. It was heavier, it
 * didn't match the rest of the app, and the blur/scrim boundary was visible.
 * If this needs to change, change `desktop-layout.tsx` too — they should stay
 * the same treatment.
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

export function ChromeFade({
  side,
  className,
}: {
  side: Side;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0 z-0", className)}
      style={{
        top: side === "top" ? 0 : undefined,
        bottom: side === "bottom" ? 0 : undefined,
        height: "100%",
        background: fadeFor(side),
      }}
    />
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
