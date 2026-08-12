/**
 * Extractor orchestration — the single entry point the import UI calls.
 *
 * Classifies each file by format, runs the matching extractor to produce
 * normalized rows + raw text, sniffs the report type, and assembles a
 * NormalizedDocument. Adding a new input format means adding an extractor
 * and a branch here — nothing downstream changes.
 */

import { detectReportType } from "../detect";
import type { ImportFormat, NormalizedDocument } from "../types";
import { extractCsvRows } from "./csv.extractor";
import { extractPdfRows } from "./pdf.extractor";

function classifyFormat(file: File): ImportFormat {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  return "csv";
}

export async function extractDocument(file: File): Promise<NormalizedDocument> {
  const format = classifyFormat(file);

  if (format === "pdf") {
    const { rows, rawText } = await extractPdfRows(file);
    return {
      format,
      reportType: detectReportType(rawText),
      rows,
      rawText,
      fileName: file.name,
    };
  }

  const { rows, rawText, delimiter } = extractCsvRows(await file.text());
  return {
    format,
    reportType: detectReportType(rawText),
    rows,
    rawText,
    fileName: file.name,
    delimiter,
  };
}

export async function extractDocuments(
  files: File[],
): Promise<NormalizedDocument[]> {
  const out: NormalizedDocument[] = [];
  for (const file of files) {
    try {
      out.push(await extractDocument(file));
    } catch (error) {
      // Name the file. A corrupt PDF or an unreadable pick used to surface as
      // a bare "Unknown import error" with no way to tell which of three
      // dropped files was the problem.
      const reason = error instanceof Error ? error.message : "unreadable";
      throw new Error(`Could not read "${file.name}": ${reason}`);
    }
  }
  return out;
}
