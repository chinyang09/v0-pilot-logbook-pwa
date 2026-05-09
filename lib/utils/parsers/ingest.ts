/**
 * Unified file ingestion entry point — extracts text from CSV or PDF,
 * detects which ecrew report each file is, and returns a normalized list
 * the unified import button can route through the right parser.
 */

import { detectReportType, type DetectedKind } from "./detect";
import { extractPdfText } from "./pdf-extract";

export type FileKind = "csv" | "pdf";

export interface ExtractedFile {
  file: File;
  kind: FileKind;
  text: string;
  detected: DetectedKind;
}

function classifyFile(file: File): FileKind {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  return "csv";
}

export async function extractText(
  file: File
): Promise<{ kind: FileKind; text: string }> {
  const kind = classifyFile(file);
  if (kind === "pdf") {
    const result = await extractPdfText(file);
    return { kind, text: result.fullText };
  }
  const text = await file.text();
  return { kind, text };
}

export async function ingestFiles(files: File[]): Promise<ExtractedFile[]> {
  const out: ExtractedFile[] = [];
  for (const file of files) {
    const { kind, text } = await extractText(file);
    out.push({
      file,
      kind,
      text,
      detected: detectReportType(text),
    });
  }
  return out;
}

export { detectReportType };
export type { DetectedKind };
