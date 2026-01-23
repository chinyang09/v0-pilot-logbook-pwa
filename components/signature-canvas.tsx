"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Check, PenLine, UserCheck } from "lucide-react";
import type {
  SignaturePoint,
  SignatureStroke,
  FlightSignature,
  SignerRole,
} from "@/lib/db";
import {
  prepareSignatureForStorage,
  renderSignatureCentered,
  migrateToVectorSignature,
  isVectorSignature,
} from "@/lib/utils/signature-vector";

// Crew member available for selection in signature
export interface SignatureCrewMember {
  id: string;
  name: string;
  role: SignerRole;
  licenseNumber?: string;
}

interface SignatureCanvasProps {
  onSave: (signature: FlightSignature) => void;
  onClear: () => void;
  onLicenseUpdate?: (crewId: string, licenseNumber: string) => void;
  initialSignature?: FlightSignature | null;
  flightCrew?: SignatureCrewMember[];
  disabled?: boolean;
}

export function SignatureCanvas({
  onSave,
  onClear,
  onLicenseUpdate,
  initialSignature,
  flightCrew = [],
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
  const [isLocked, setIsLocked] = useState(
    !!(initialSignature?.strokes && initialSignature.strokes.length > 0)
  );

  const [selectedCrewId, setSelectedCrewId] = useState<string>(
    initialSignature?.signerId || ""
  );
  const [licenseInput, setLicenseInput] = useState<string>("");

  const selectedCrew = flightCrew.find((c) => c.id === selectedCrewId);

  // Initialize canvas size - re-run when crew is selected (container mounts)
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setCanvasSize({ width: rect.width, height: 120 });
      }
    };

    // Small delay to ensure DOM has rendered
    const timer = setTimeout(updateSize, 10);
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateSize);
    };
  }, [selectedCrewId, isLocked]);

  // Draw all strokes on canvas
  // For locked/saved signatures: use vector rendering with aspect ratio preservation
  // For active drawing: use direct canvas rendering for real-time feedback
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const computedStyle = getComputedStyle(canvas);
    const foregroundColor = computedStyle.color || "#ffffff";

    // If locked and we have a saved signature, use aspect-preserving render
    if (isLocked && initialSignature && initialSignature.strokes.length > 0) {
      // Migrate old signatures to vector format if needed
      const vectorSignature = isVectorSignature(initialSignature)
        ? initialSignature
        : migrateToVectorSignature(initialSignature);

      renderSignatureCentered(ctx, vectorSignature, {
        strokeColor: foregroundColor,
        lineWidth: 2,
        padding: 0.08, // 8% padding
      });
      return;
    }

    // For active drawing, use direct canvas rendering
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = foregroundColor;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const allStrokes = [...strokes];
    if (currentStroke.length > 0) {
      allStrokes.push({
        points: currentStroke,
        startTime: strokeStartTime.current,
      });
    }

    for (const stroke of allStrokes) {
      if (stroke.points.length < 2) continue;

      ctx.beginPath();
      const firstPoint = stroke.points[0];
      ctx.moveTo(firstPoint.x * canvas.width, firstPoint.y * canvas.height);

      for (let i = 1; i < stroke.points.length; i++) {
        const point = stroke.points[i];
        if (point.pressure !== undefined) {
          ctx.lineWidth = 1 + point.pressure * 3;
        }
        ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
      }
      ctx.stroke();
    }
  }, [strokes, currentStroke, isLocked, initialSignature]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas, canvasSize]);

  useEffect(() => {
    if (initialSignature?.strokes && initialSignature.strokes.length > 0) {
      setStrokes(initialSignature.strokes);
      setHasUnsavedChanges(false);
      setIsLocked(true);
      if (initialSignature.signerId) {
        setSelectedCrewId(initialSignature.signerId);
      }
    } else {
      setStrokes([]);
      setIsLocked(false);
    }
  }, [initialSignature]);

  const getPoint = useCallback(
    (
      e:
        | React.MouseEvent<HTMLCanvasElement>
        | React.TouchEvent<HTMLCanvasElement>
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
        if ("force" in touch) {
          pressure = (touch as unknown as { force: number }).force;
        }
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
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
      e:
        | React.MouseEvent<HTMLCanvasElement>
        | React.TouchEvent<HTMLCanvasElement>
    ) => {
      if (disabled || isLocked || !selectedCrewId) return;
      e.preventDefault();
      setIsDrawing(true);
      strokeStartTime.current = Date.now();
      const point = getPoint(e);
      setCurrentStroke([point]);
    },
    [disabled, isLocked, selectedCrewId, getPoint]
  );

  const handleMove = useCallback(
    (
      e:
        | React.MouseEvent<HTMLCanvasElement>
        | React.TouchEvent<HTMLCanvasElement>
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
      e:
        | React.MouseEvent<HTMLCanvasElement>
        | React.TouchEvent<HTMLCanvasElement>
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
    if (strokes.length === 0 || !selectedCrewId) return;

    const licenseNumber =
      selectedCrew?.licenseNumber || licenseInput || undefined;

    if (licenseInput && selectedCrewId && onLicenseUpdate) {
      onLicenseUpdate(selectedCrewId, licenseInput);
    }

    // Prepare signature with vector normalization
    // This computes bounds, normalizes strokes, and calculates aspect ratio
    const {
      strokes: normalizedStrokes,
      bounds,
      aspectRatio,
    } = prepareSignatureForStorage(
      strokes,
      canvasSize.width,
      canvasSize.height
    );

    const signature: FlightSignature = {
      strokes: normalizedStrokes,
      bounds,
      aspectRatio,
      canvasWidth: canvasSize.width, // Keep for backward compatibility
      canvasHeight: canvasSize.height,
      capturedAt: Date.now(),
      signerId: selectedCrewId,
      signerRole: selectedCrew?.role,
      signerName: selectedCrew?.name,
      signerLicenseNumber: licenseNumber,
    };

    onSave(signature);
    setHasUnsavedChanges(false);
    setIsLocked(true);
  }, [
    strokes,
    canvasSize,
    selectedCrewId,
    selectedCrew,
    licenseInput,
    onLicenseUpdate,
    onSave,
  ]);

  const handleResign = useCallback(() => {
    setStrokes([]);
    setCurrentStroke([]);
    setHasUnsavedChanges(false);
    setIsLocked(false);
    setSelectedCrewId("");
    setLicenseInput("");
    onClear();
  }, [onClear]);

  const handleCrewChange = useCallback((crewId: string) => {
    setSelectedCrewId(crewId);
    setLicenseInput("");
  }, []);

  const hasSignature = strokes.length > 0;
  const showLicenseInput = selectedCrew && !selectedCrew.licenseNumber;
  const canSign = selectedCrewId && !isLocked;

  // Locked state - show saved signature with signer details
  if (isLocked && initialSignature) {
    return (
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {/* Signer Info Header */}
        <div className="px-4 py-3 bg-muted/50 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-medium">
                  {initialSignature.signerName}
                  {initialSignature.signerRole && (
                    <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                      ({initialSignature.signerRole.toUpperCase()})
                    </span>
                  )}
                </p>
                {initialSignature.signerLicenseNumber && (
                  <p className="text-xs text-muted-foreground">
                    License: {initialSignature.signerLicenseNumber}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResign}
              disabled={disabled}
              className="text-xs h-7"
            >
              <PenLine className="h-3.5 w-3.5 mr-1" />
              Re-sign
            </Button>
          </div>
        </div>

        {/* Signature Display */}
        <div ref={containerRef} className="relative bg-background">
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            className="w-full touch-none text-foreground"
          />
          {/* Signature line */}
          <div className="absolute bottom-6 left-4 right-4 border-b border-dashed border-muted-foreground/30" />
        </div>

        {/* Timestamp */}
        <div className="px-4 py-2 bg-muted/30 border-t border-border">
          <p className="text-[10px] text-muted-foreground text-center">
            Signed on{" "}
            {new Date(initialSignature.capturedAt).toLocaleDateString(
              undefined,
              {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }
            )}
          </p>
        </div>
      </div>
    );
  }

  // No crew available
  if (flightCrew.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6">
        <div className="text-center text-muted-foreground">
          <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">No crew assigned</p>
          <p className="text-xs mt-1">
            Assign crew members to this flight to enable signature capture
          </p>
        </div>
      </div>
    );
  }

  // Editable state
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Crew Selection Header */}
      <div className="px-4 py-3 bg-muted/50 border-b border-border space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Signing Crew Member
          </Label>
          <Select
            value={selectedCrewId}
            onValueChange={handleCrewChange}
            disabled={disabled}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue placeholder="Select who is signing..." />
            </SelectTrigger>
            <SelectContent>
              {flightCrew.map((crew) => (
                <SelectItem key={crew.id} value={crew.id}>
                  <span className="font-medium">{crew.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    ({crew.role.toUpperCase()})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* License field - only show when crew is selected */}
        {selectedCrew && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              License Number
            </Label>
            {showLicenseInput ? (
              <Input
                type="text"
                placeholder="Enter license number"
                value={licenseInput}
                onChange={(e) => setLicenseInput(e.target.value)}
                disabled={disabled}
                className="bg-background"
              />
            ) : (
              <div className="px-3 py-2 bg-background rounded-md border border-input text-sm">
                {selectedCrew.licenseNumber}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Signature Canvas - only show when crew is selected */}
      {canSign ? (
        <>
          <div ref={containerRef} className="relative bg-background">
            <canvas
              ref={canvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              className="w-full touch-none text-foreground cursor-crosshair"
              onMouseDown={handleStart}
              onMouseMove={handleMove}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onTouchStart={handleStart}
              onTouchMove={handleMove}
              onTouchEnd={handleEnd}
            />
            {/* Signature line */}
            <div className="absolute bottom-6 left-4 right-4 border-b border-dashed border-muted-foreground/30" />
            {/* Placeholder text */}
            {!hasSignature && !isDrawing && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-muted-foreground/50 text-sm">
                  Sign above the line
                </span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="px-4 py-3 bg-muted/30 border-t border-border">
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                disabled={disabled || !hasSignature}
                className="flex-1"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Clear
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={disabled || !hasSignature || !hasUnsavedChanges}
                className="flex-1"
              >
                <Check className="h-4 w-4 mr-1.5" />
                Save Signature
              </Button>
            </div>
          </div>
        </>
      ) : (
        /* Prompt to select crew */
        <div className="px-4 py-8 bg-background">
          <div className="text-center text-muted-foreground">
            <PenLine className="h-6 w-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Select a crew member above to sign</p>
          </div>
        </div>
      )}
    </div>
  );
}
