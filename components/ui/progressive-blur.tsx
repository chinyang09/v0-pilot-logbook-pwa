/**
 * Progressive blur — a directional blur that is strongest at one edge and
 * fades to nothing, so content scrolling underneath dissolves rather than
 * hitting a hard line. Same idiom the sidebar backdrop uses (a stack of
 * `backdrop-filter` layers, each masked to a shorter band).
 *
 * The band is split in two: a **covered** region over the chrome itself
 * (full blur + a half-opaque scrim — content still flows visibly behind the
 * glass, it is just blurred and muted) and a short **fade tail** past it where
 * both ease off. The tail is deliberately small: long enough that the blur
 * never ends on a visible line, short enough that it doesn't wash out the
 * first row of real content or push it down with dead space.
 *
 * Scroll areas pad by `PROGRESSIVE_BLUR_CLEAR` — less than the full tail, so
 * the first row sits in the faintest part of the gradient rather than below it
 * entirely.
 *
 * Purely decorative: always `pointer-events-none`.
 */

"use client";

import { cn } from "@/lib/utils";

type Side = "top" | "bottom";

/** Height of the taper past the chrome, in px. */
const FADE = 26;

/**
 * How far a scroll container should pad past the chrome. Less than `FADE` on
 * purpose — the first row lands in the tail's faintest stretch, so the blur
 * stays continuous without the row being pushed away behind dead space.
 */
export const PROGRESSIVE_BLUR_CLEAR = 14;

/**
 * Blur radius (px) paired with how far into the FADE TAIL that layer reaches
 * (0–1). Everything reaches all the way across the covered region. The heavy
 * radii stop early so the tail is a light haze rather than a smear.
 */
const LAYERS: Array<{ blur: number; reach: number }> = [
  { blur: 2, reach: 1 },
  { blur: 5, reach: 0.55 },
  { blur: 11, reach: 0.26 },
  { blur: 20, reach: 0.08 },
];

const F = FADE;

function maskFor(side: Side, reach: number): string {
  const to = side === "top" ? "bottom" : "top";
  // Full strength up to the start of the tail, then out over `reach` of it.
  return `linear-gradient(to ${to}, black 0, black calc(100% - ${F}px), transparent calc(100% - ${F * (1 - reach)}px))`;
}

/**
 * Half-opaque over the chrome, gone by the end of the tail. Deliberately not
 * near-solid: the point is that scrolled content stays visible through the
 * glass, blurred and muted rather than hidden behind a painted band.
 */
function scrimFor(side: Side): string {
  const to = side === "top" ? "bottom" : "top";
  const solid = `color-mix(in srgb, var(--background) 52%, transparent)`;
  const mid = `color-mix(in srgb, var(--background) 24%, transparent)`;
  return `linear-gradient(to ${to}, ${solid} 0, ${solid} calc(100% - ${F}px), ${mid} calc(100% - ${F * 0.5}px), transparent 100%)`;
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
        height: `calc(100% + ${FADE}px)`,
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
