"use client";

import type React from "react";
import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processScootCSV } from "@/lib/utils/parsers/scoot-parser";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

interface ImportProgress {
  percent: number;
  stage: string;
  detail?: string;
}

export function CSVImportButton({ onComplete }: { onComplete: () => void }) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setShowDialog(true);
    setProgress({ percent: 0, stage: "Starting", detail: "Reading file..." });

    try {
      const content = await file.text();

      const result = await processScootCSV(content, {
        onProgress: (percent, stage, detail) => {
          setProgress({ percent, stage, detail });
        },
      });

      // Show success briefly
      setProgress({
        percent: 100,
        stage: "Complete!",
        detail: `Imported ${result.flightsImported} flights${
          result.personnelCreated > 0
            ? `, ${result.personnelCreated} new crew`
            : ""
        }`,
      });

      // Wait a moment to show success message
      await new Promise((resolve) => setTimeout(resolve, 1000));

      onComplete();
    } catch (error) {
      console.error("Import failed", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to parse CSV";

      setProgress({
        percent: 0,
        stage: "Error",
        detail: errorMessage,
      });

      // Keep error visible longer
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } finally {
      setLoading(false);
      setShowDialog(false);
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".csv"
        onChange={handleFileChange}
      />

      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        disabled={loading}
        onClick={() => fileInputRef.current?.click()}
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Upload className="h-5 w-5" />
        )}
      </Button>

      <Dialog open={showDialog} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" hideCloseButton>
          <DialogHeader>
            <DialogTitle>Importing Flights</DialogTitle>
            <DialogDescription>
              {progress?.stage || "Processing..."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Progress value={progress?.percent || 0} className="h-2" />

            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{progress?.detail || ""}</span>
              <span>{progress?.percent || 0}%</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
