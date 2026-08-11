"use client";

import { useEffect, useRef } from "react";

import type { FlightSignature } from "@/types/entities/flight.types";
import {
  isVectorSignature,
  migrateToVectorSignature,
  renderSignatureCentered,
} from "@/lib/utils/signature-vector";
import { cn } from "@/lib/utils";

/**
 * A signed signature, rendered read-only at whatever size it is given.
 *
 * `SignatureCanvas` already knows how to paint one, but it is the whole
 * signing surface — crew picker, licence field, clear/save, a live drawing
 * session. Somewhere that only needs to SHOW the mark (the flight card's
 * context preview) would otherwise have to mount all of that disabled.
 *
 * The strokes are normalised to their own bounding box at capture time, so
 * `renderSignatureCentered` fits them to any box while preserving the original
 * aspect ratio — which is what lets a signature drawn in landscape render
 * correctly in a short strip like this one.
 *
 * Painted once per signature/size/theme change. There is no animation here on
 * purpose: this sits inside an overlay that is already morphing, and a canvas
 * repaint per frame would be competing with it.
 */
export function SignatureMark({
  signature,
  className,
  height = 56,
  renderWidth,
}: {
  signature: FlightSignature;
  className?: string;
  /** CSS height of the strip; the width is whatever the container gives. */
  height?: number;
  /**
   * The width to back the bitmap at, when the container is going to CHANGE
   * width after this paints.
   *
   * The canvas is laid out `w-full`, so the browser scales the bitmap to
   * whatever the box currently is. Downscaling is fine; upscaling is not. The
   * context preview animates its card's width — on a tablet from ~336 to 672 —
   * so a bitmap sized from `clientWidth` at mount would be stretched to twice
   * its resolution by the time the morph settles, and the signature would come
   * to rest visibly soft. Passing the RESTING width paints once, at the size it
   * will end up, and every frame before that is a downscale.
   */
  renderWidth?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Back the canvas at device resolution — a signature is thin strokes, and
    // at 1x on a 3x phone it reads as a smudge.
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = renderWidth ?? canvas.clientWidth;
    if (cssWidth <= 0) return;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(height * dpr);

    const vector = isVectorSignature(signature)
      ? signature
      : migrateToVectorSignature(signature);

    renderSignatureCentered(ctx, vector, {
      // `currentColor` resolved off the element, so the mark follows the theme
      // the same way the text around it does.
      strokeColor: getComputedStyle(canvas).color || "#ffffff",
      lineWidth: 2 * dpr,
      padding: 0.04,
    });
  }, [signature, height, renderWidth]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Signature"
      role="img"
      className={cn("w-full text-foreground", className)}
      style={{ height }}
    />
  );
}
