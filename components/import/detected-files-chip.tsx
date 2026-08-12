"use client";

import { FileText, FileWarning } from "lucide-react";
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
            <span className=" text-[11px]">{f.fileName}</span>
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
