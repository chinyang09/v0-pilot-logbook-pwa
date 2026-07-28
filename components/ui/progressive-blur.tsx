/**
 * Progressive blur — a directional blur that is strongest at one edge and
 * fades to nothing, so content scrolling underneath dissolves rather than
 * hitting a hard line. Same idiom the sidebar backdrop uses (a stack of
 * `backdrop-filter` layers, each masked to a shorter band).
 *
 * The band is split in two: a **solid** region that covers the chrome itself
 * (fully blurred + an almost-opaque scrim, so nothing leaks through behind the
 * title/actions) and a short **fade tail** past it where both taper off. The
 * tail is deliberately small — a long gradient washes out the first line of
 * real content, which is the opposite of what the chrome is for. Pad the
 * scroll area by `PROGRESSIVE_BLUR_FADE` so content at rest clears the tail.
 *
 * Purely decorative: always `pointer-events-none`.
 */

"use client";

import { cn } from "@/lib/utils";

type Side = "top" | "bottom";

/**
 * Height of the taper past the chrome, in px. Exported so a scroll container
 * can pad by exactly this much and keep its first row out of the gradient.
 */
export const PROGRESSIVE_BLUR_FADE = 40;

/**
 * Blur radius (px) paired with how far into the FADE TAIL that layer reaches
 * (0–1). Everything reaches all the way across the solid region.
 */
const LAYERS: Array<{ blur: number; reach: number }> = [
  { blur: 2, reach: 1 },
  { blur: 6, reach: 0.62 },
  { blur: 14, reach: 0.32 },
  { blur: 24, reach: 0.12 },
];

const F = PROGRESSIVE_BLUR_FADE;

function maskFor(side: Side, reach: number): string {
  const to = side === "top" ? "bottom" : "top";
  // Opaque up to the start of the tail, then out over `reach` of the tail.
  return `linear-gradient(to ${to}, black 0, black calc(100% - ${F}px), transparent calc(100% - ${F * (1 - reach)}px))`;
}

/** Near-opaque over the chrome, gone by the end of the tail. */
function scrimFor(side: Side): string {
  const to = side === "top" ? "bottom" : "top";
  const solid = `color-mix(in srgb, var(--background) 88%, transparent)`;
  const mid = `color-mix(in srgb, var(--background) 46%, transparent)`;
  return `linear-gradient(to ${to}, ${solid} 0, ${solid} calc(100% - ${F}px), ${mid} calc(100% - ${F * 0.45}px), transparent 100%)`;
}

export function ProgressiveBlur({
  side,
  className,
  /** Optional scrim so text over the blur keeps contrast. */
  scrim = true,
}: {
  side: Side;
  className?: string;
  scrim?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0 z-0", className)}
      style={{
        top: side === "top" ? 0 : undefined,
        bottom: side === "bottom" ? 0 : undefined,
        // The chrome's own height plus the taper.
        height: `calc(100% + ${F}px)`,
      }}
    >
      {LAYERS.map(({ blur, reach }) => (
        <div
          key={blur}
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${blur}px)`,
            WebkitBackdropFilter: `blur(${blur}px)`,
            maskImage: maskFor(side, reach),
            WebkitMaskImage: maskFor(side, reach),
          }}
        />
      ))}
      {scrim && (
        <div
          className="absolute inset-0"
          style={{ background: scrimFor(side) }}
        />
      )}
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
