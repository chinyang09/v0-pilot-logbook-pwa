/**
 * Progressive blur — a directional blur that is strongest at one edge and
 * fades to nothing, so content scrolling underneath dissolves rather than
 * hitting a hard line. Same idiom the sidebar backdrop uses (a stack of
 * `backdrop-filter` layers, each masked to a shorter band).
 *
 * Purely decorative: always `pointer-events-none`.
 */

"use client";

import { cn } from "@/lib/utils";

type Side = "top" | "bottom";

/** Blur radius (px) paired with how far the layer reaches, as a % of the band. */
const LAYERS: Array<{ blur: number; reach: number }> = [
  { blur: 1, reach: 100 },
  { blur: 3, reach: 72 },
  { blur: 8, reach: 46 },
  { blur: 18, reach: 24 },
];

function maskFor(side: Side, reach: number): string {
  const to = side === "top" ? "bottom" : "top";
  return `linear-gradient(to ${to}, black 0%, black ${reach * 0.35}%, transparent ${reach}%)`;
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
      style={side === "top" ? { top: 0 } : { bottom: 0 }}
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
          style={{
            background: `linear-gradient(to ${side === "top" ? "bottom" : "top"}, color-mix(in srgb, var(--background) 94%, transparent) 0%, color-mix(in srgb, var(--background) 72%, transparent) 45%, color-mix(in srgb, var(--background) 30%, transparent) 75%, transparent 100%)`,
          }}
        />
      )}
    </div>
  );
}

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
