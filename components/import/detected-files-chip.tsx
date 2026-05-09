"use client";

import { FileText, FileWarning, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExtractedFile } from "@/lib/utils/parsers/ingest";

interface DetectedFilesChipProps {
  files: ExtractedFile[];
}

const KIND_LABEL: Record<ExtractedFile["detected"], string> = {
  logbook: "Logbook",
  schedule: "Schedule",
  unknown: "Unknown",
};

export function DetectedFilesChip({ files }: DetectedFilesChipProps) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f, idx) => {
        const isUnknown = f.detected === "unknown";
        return (
          <Badge
            key={`${f.file.name}-${idx}`}
            variant={isUnknown ? "outline" : "secondary"}
            className="gap-1.5"
          >
            {isUnknown ? (
              <FileWarning className="h-3 w-3" />
            ) : (
              <FileText className="h-3 w-3" />
            )}
            <span className="font-mono text-[11px]">{f.file.name}</span>
            <span className="text-[10px] uppercase opacity-70">
              {f.kind}
            </span>
            <span>•</span>
            <span className="text-[11px]">{KIND_LABEL[f.detected]}</span>
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
