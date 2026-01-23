/**
 * Vector-based signature utilities
 *
 * This module implements the vector signature system for the OOOI PWA.
 * Signatures are captured as vector strokes, normalized to their bounding box,
 * and rendered with uniform scaling to preserve aspect ratio.
 *
 * Key concepts:
 * - Capture: Raw strokes normalized to canvas (0-1 range)
 * - Normalize: Transform strokes to their own bounding box (0-1 range)
 * - Render: Use uniform scaling and centering for aspect-safe display
 */

import type {
  SignaturePoint,
  SignatureStroke,
  SignatureBounds,
  FlightSignature,
} from "@/types/entities/flight.types";

/**
 * Compute the bounding box of all stroke points
 * Returns the min/max coordinates that contain all points
 */
export function computeBounds(strokes: SignatureStroke[]): SignatureBounds {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const stroke of strokes) {
    for (const p of stroke.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  // Handle edge case where all points are the same
  if (maxX === minX) {
    minX = Math.max(0, minX - 0.01);
    maxX = Math.min(1, maxX + 0.01);
  }
  if (maxY === minY) {
    minY = Math.max(0, minY - 0.01);
    maxY = Math.min(1, maxY + 0.01);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Normalize strokes to their own bounding box
 * After normalization, the signature occupies (0,0) → (1,1)
 * This removes positional bias (e.g., signing off-center)
 */
export function normalizeStrokesToBounds(
  strokes: SignatureStroke[],
  bounds: SignatureBounds
): SignatureStroke[] {
  const { minX, minY, maxX, maxY } = bounds;
  const width = maxX - minX;
  const height = maxY - minY;

  // Avoid division by zero
  if (width === 0 || height === 0) {
    return strokes;
  }

  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((p) => ({
      ...p,
      x: (p.x - minX) / width,
      y: (p.y - minY) / height,
    })),
  }));
}

/**
 * Compute aspect ratio from bounds
 * This is used during rendering to preserve the signature's original proportions
 */
export function computeAspectRatio(bounds: SignatureBounds): number {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  // Avoid division by zero, default to 1:1 aspect ratio
  if (height === 0) return 1;

  return width / height;
}

/**
 * Prepare a signature for storage
 * Computes bounds, normalizes strokes, and calculates aspect ratio
 *
 * @param rawStrokes - Strokes captured from canvas (normalized to canvas 0-1)
 * @param canvasWidth - Width of the capture canvas
 * @param canvasHeight - Height of the capture canvas
 * @returns Processed strokes, bounds, and aspect ratio
 */
export function prepareSignatureForStorage(
  rawStrokes: SignatureStroke[],
  canvasWidth: number,
  canvasHeight: number
): {
  strokes: SignatureStroke[];
  bounds: SignatureBounds;
  aspectRatio: number;
} {
  if (rawStrokes.length === 0) {
    return {
      strokes: [],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      aspectRatio: 1,
    };
  }

  // Compute bounds in canvas-normalized space
  const rawBounds = computeBounds(rawStrokes);

  // Convert bounds to actual pixel dimensions to compute true aspect ratio
  // This accounts for non-square canvas aspect ratios
  const pixelWidth = (rawBounds.maxX - rawBounds.minX) * canvasWidth;
  const pixelHeight = (rawBounds.maxY - rawBounds.minY) * canvasHeight;

  // True aspect ratio in pixel space
  const aspectRatio = pixelHeight > 0 ? pixelWidth / pixelHeight : 1;

  // Normalize strokes to their own bounding box
  const normalizedStrokes = normalizeStrokesToBounds(rawStrokes, rawBounds);

  return {
    strokes: normalizedStrokes,
    bounds: rawBounds,
    aspectRatio,
  };
}

/**
 * Render a signature to a canvas with aspect-preserving uniform scaling and centering
 *
 * @param ctx - Canvas 2D rendering context
 * @param signature - The signature to render
 * @param options - Rendering options
 */
export function renderSignatureCentered(
  ctx: CanvasRenderingContext2D,
  signature: FlightSignature,
  options: {
    strokeColor?: string;
    lineWidth?: number;
    padding?: number; // Padding as fraction of canvas size (0-1)
  } = {}
) {
  const { strokeColor = "#000000", lineWidth = 2, padding = 0.1 } = options;

  const canvas = ctx.canvas;
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  // Clear the canvas
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (!signature.strokes || signature.strokes.length === 0) {
    return;
  }

  // Get aspect ratio (use stored value or default to 1)
  const sigAspectRatio = signature.aspectRatio ?? 1;

  // Available space after padding
  const availableWidth = canvasWidth * (1 - padding * 2);
  const availableHeight = canvasHeight * (1 - padding * 2);
  const availableAspectRatio = availableWidth / availableHeight;

  // Calculate uniform scale to fit signature while preserving aspect ratio
  let renderWidth: number;
  let renderHeight: number;

  if (sigAspectRatio > availableAspectRatio) {
    // Signature is wider than available space - fit to width
    renderWidth = availableWidth;
    renderHeight = availableWidth / sigAspectRatio;
  } else {
    // Signature is taller than available space - fit to height
    renderHeight = availableHeight;
    renderWidth = availableHeight * sigAspectRatio;
  }

  // Center the signature
  const offsetX = (canvasWidth - renderWidth) / 2;
  const offsetY = (canvasHeight - renderHeight) / 2;

  // Setup stroke style
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = strokeColor;

  // Draw each stroke
  for (const stroke of signature.strokes) {
    if (stroke.points.length < 2) continue;

    ctx.beginPath();
    const firstPoint = stroke.points[0];
    ctx.moveTo(
      offsetX + firstPoint.x * renderWidth,
      offsetY + firstPoint.y * renderHeight
    );

    for (let i = 1; i < stroke.points.length; i++) {
      const point = stroke.points[i];

      // Apply pressure-based line width if available
      if (point.pressure !== undefined) {
        ctx.lineWidth = lineWidth * (0.5 + point.pressure * 1.5);
      } else {
        ctx.lineWidth = lineWidth;
      }

      ctx.lineTo(
        offsetX + point.x * renderWidth,
        offsetY + point.y * renderHeight
      );
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Check if a signature has the new vector format (with aspectRatio)
 * Used for backward compatibility with old signatures
 */
export function isVectorSignature(signature: FlightSignature): boolean {
  return signature.aspectRatio !== undefined;
}

/**
 * Migrate an old signature format to the new vector format
 * Old signatures stored raw canvas-normalized coordinates without aspect ratio
 * We estimate the aspect ratio from canvasWidth/canvasHeight if available
 */
export function migrateToVectorSignature(
  signature: FlightSignature
): FlightSignature {
  if (isVectorSignature(signature)) {
    return signature;
  }

  // For old signatures, we need to estimate the aspect ratio
  // If we have canvas dimensions, use them to approximate
  const canvasWidth = signature.canvasWidth ?? 400;
  const canvasHeight = signature.canvasHeight ?? 120;

  // Compute bounds from existing strokes
  const bounds = computeBounds(signature.strokes);

  // Calculate pixel dimensions of the signature
  const pixelWidth = (bounds.maxX - bounds.minX) * canvasWidth;
  const pixelHeight = (bounds.maxY - bounds.minY) * canvasHeight;

  // Estimate aspect ratio
  const aspectRatio = pixelHeight > 0 ? pixelWidth / pixelHeight : 1;

  // Normalize strokes to bounds
  const normalizedStrokes = normalizeStrokesToBounds(signature.strokes, bounds);

  return {
    ...signature,
    strokes: normalizedStrokes,
    bounds,
    aspectRatio,
  };
}
