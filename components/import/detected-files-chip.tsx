"use client";

import { FileText, FileWarning, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { NormalizedDocument } from "@/lib/utils/parsers/types";

interface DetectedFilesChipProps {
  files: NormalizedDocument[];
}

const KIND_LABEL: Record<NormalizedDocument["reportType"], string> = {
  logbook: "Logbook",
  schedule: "Schedule",
  unknown: "Unknown",
};

export function DetectedFilesChip({ files }: DetectedFilesChipProps) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f, idx) => {
        const isUnknown = f.reportType === "unknown";
        return (
          <Badge
            key={`${f.fileName}-${idx}`}
            variant={isUnknown ? "outline" : "secondary"}
            className="gap-1.5"
          >
            {isUnknown ? (
              <FileWarning className="h-3 w-3" />
            ) : (
              <FileText className="h-3 w-3" />
            )}
            <span className="font-mono text-[11px]">{f.fileName}</span>
            <span className="text-[10px] uppercase opacity-70">
              {f.format}
            </span>
            <span>•</span>
            <span className="text-[11px]">{KIND_LABEL[f.reportType]}</span>
          </Badge>
        );
      })}
    </div>
  );
}

export function ImportSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </span>
  );
}
