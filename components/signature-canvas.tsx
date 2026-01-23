"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Check, PenLine } from "lucide-react";
import type {
  SignaturePoint,
  SignatureStroke,
  FlightSignature,
  SignerRole,
} from "@/lib/db";

interface SignatureCanvasProps {
  onSave: (signature: FlightSignature) => void;
  onClear: () => void;
  initialSignature?: FlightSignature | null;
  signerRole?: SignerRole;
  signerName?: string;
  disabled?: boolean;
}

export function SignatureCanvas({
  onSave,
  onClear,
  initialSignature,
  signerRole,
  signerName,
  disabled = false,
}: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokes, setStrokes] = useState<SignatureStroke[]>(
    initialSignature?.strokes || []
  );
  const [currentStroke, setCurrentStroke] = useState<SignaturePoint[]>([]);
  const strokeStartTime = useRef<number>(0);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // Lock state: signature is locked when loaded from saved data or after save
  const [isLocked, setIsLocked] = useState(
    !!(initialSignature?.strokes && initialSignature.strokes.length > 0)
  );

  // Initialize canvas size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setCanvasSize({ width: rect.width, height: 150 });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Draw all strokes on canvas
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get the foreground color from computed style (inherits from CSS)
    const computedStyle = getComputedStyle(canvas);
    const foregroundColor = computedStyle.color || "#ffffff";

    // Set drawing style
    ctx.strokeStyle = foregroundColor;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Draw all strokes
    const allStrokes = [...strokes];
    if (currentStroke.length > 0) {
      allStrokes.push({ points: currentStroke, startTime: strokeStartTime.current });
    }

    for (const stroke of allStrokes) {
      if (stroke.points.length < 2) continue;

      ctx.beginPath();
      const firstPoint = stroke.points[0];
      ctx.moveTo(firstPoint.x * canvas.width, firstPoint.y * canvas.height);

      for (let i = 1; i < stroke.points.length; i++) {
        const point = stroke.points[i];
        // Vary line width based on pressure if available
        if (point.pressure !== undefined) {
          ctx.lineWidth = 1 + point.pressure * 3;
        }
        ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
      }
      ctx.stroke();
    }
  }, [strokes, currentStroke]);

  // Redraw when strokes or canvas size changes
  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas, canvasSize]);

  // Load initial signature
  useEffect(() => {
    if (initialSignature?.strokes && initialSignature.strokes.length > 0) {
      setStrokes(initialSignature.strokes);
      setHasUnsavedChanges(false);
      setIsLocked(true);
    } else {
      setStrokes([]);
      setIsLocked(false);
    }
  }, [initialSignature]);

  // Get normalized coordinates from event
  const getPoint = useCallback(
    (
      e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
    ): SignaturePoint => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0, timestamp: 0 };

      const rect = canvas.getBoundingClientRect();
      let clientX: number;
      let clientY: number;
      let pressure: number | undefined;

      if ("touches" in e) {
        const touch = e.touches[0] || e.changedTouches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
        // Try to get pressure from touch event
        if ("force" in touch) {
          pressure = (touch as any).force;
        }
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
        // Check for pointer pressure
        if ("pressure" in e.nativeEvent) {
          pressure = (e.nativeEvent as PointerEvent).pressure;
        }
      }

      return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height,
        pressure,
        timestamp: Date.now() - strokeStartTime.current,
      };
    },
    []
  );

  const handleStart = useCallback(
    (
      e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
    ) => {
      if (disabled || isLocked) return;
      e.preventDefault();
      setIsDrawing(true);
      strokeStartTime.current = Date.now();
      const point = getPoint(e);
      setCurrentStroke([point]);
    },
    [disabled, isLocked, getPoint]
  );

  const handleMove = useCallback(
    (
      e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
    ) => {
      if (!isDrawing || disabled || isLocked) return;
      e.preventDefault();
      const point = getPoint(e);
      setCurrentStroke((prev) => [...prev, point]);
    },
    [isDrawing, disabled, isLocked, getPoint]
  );

  const handleEnd = useCallback(
    (
      e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
    ) => {
      if (!isDrawing) return;
      e.preventDefault();
      setIsDrawing(false);

      if (currentStroke.length > 1) {
        const newStroke: SignatureStroke = {
          points: currentStroke,
          startTime: strokeStartTime.current,
        };
        setStrokes((prev) => [...prev, newStroke]);
        setHasUnsavedChanges(true);
      }
      setCurrentStroke([]);
    },
    [isDrawing, currentStroke]
  );

  const handleClear = useCallback(() => {
    setStrokes([]);
    setCurrentStroke([]);
    setHasUnsavedChanges(false);
    onClear();
  }, [onClear]);

  const handleSave = useCallback(() => {
    if (strokes.length === 0) return;

    const signature: FlightSignature = {
      strokes,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      capturedAt: Date.now(),
      signerRole,
      signerName,
    };

    onSave(signature);
    setHasUnsavedChanges(false);
    setIsLocked(true);
  }, [strokes, canvasSize, signerRole, signerName, onSave]);

  // Handle re-sign action
  const handleResign = useCallback(() => {
    setStrokes([]);
    setCurrentStroke([]);
    setHasUnsavedChanges(false);
    setIsLocked(false);
    onClear();
  }, [onClear]);

  const hasSignature = strokes.length > 0;

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative border border-border rounded-lg bg-background overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className={`w-full touch-none text-foreground ${
            disabled || isLocked ? "cursor-default" : "cursor-crosshair"
          }`}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
        {!hasSignature && !isDrawing && !isLocked && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-muted-foreground text-sm">
              Sign here
            </span>
          </div>
        )}
      </div>

      {isLocked ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Signature saved
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResign}
            disabled={disabled}
            className="flex items-center gap-1.5"
          >
            <PenLine className="h-4 w-4" />
            Re-sign
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={disabled || !hasSignature}
              className="flex items-center gap-1.5"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={disabled || !hasSignature || !hasUnsavedChanges}
              className="flex items-center gap-1.5"
            >
              <Check className="h-4 w-4" />
              Save Signature
            </Button>
          </div>

          {hasSignature && !hasUnsavedChanges && (
            <p className="text-xs text-muted-foreground text-center">
              Signature saved
            </p>
          )}
        </>
      )}
    </div>
  );
}
