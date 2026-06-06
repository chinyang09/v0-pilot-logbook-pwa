/**
 * Normalized intermediate structure shared by every importer.
 *
 * The import pipeline is layered:
 *
 *   File ──[extractor]──▶ NormalizedDocument ──[parser]──▶ Planned*Import
 *                                                ──▶ reconcile ──▶ review ──▶ execute
 *
 * Extractors are format-specific (CSV, PDF, and — in future — OCR'd
 * screenshots, other-airline PDFs, pasted email text). Their ONLY job is to
 * turn a source into normalized rows + raw text. They do no field parsing.
 *
 * The parser layer (logbook / schedule) is format-agnostic: it consumes a
 * NormalizedDocument and never sees a File, a PDF, or raw CSV text. This is
 * where all field interpretation lives, so adding a new format means adding
 * one extractor — never touching the parsers.
 */

import type { DetectedKind } from "./detect";

/**
 * Source format a document was extracted from. Extend this union (and add a
 * matching extractor) to support new inputs — e.g. "ocr" | "paste".
 */
export type ImportFormat = "csv" | "pdf";

/**
 * One normalized source row: the original line plus its quote-aware cells.
 *
 * Parsers read `raw` for structural sniffing (titles, header rows, section
 * markers, date-range lines, `startsWith` checks) and `cells` for field
 * values. Splitting into cells happens once, in the extractor, so the parser
 * never re-splits.
 */
export interface NormalizedRow {
  /** 0-based position within the source document (used as the source line
   *  number for diagnostics: `sourceLine = index + 1`). */
  index: number;
  /** Original line text — cells joined by ",". */
  raw: string;
  /** Quote-aware split cells. A cell may itself contain embedded newlines:
   *  schedule reports pack multiple sectors into a single cell. */
  cells: string[];
  /**
   * PDF Y-coordinate of this row (top-left origin). Set only by the PDF
   * extractor; undefined for CSV. The schedule parser uses Y-gaps to group
   * consecutive PDF rows back into single table entries — the schedule PDF
   * splits one visual row across 3-10 Y-buckets (top sector, date row,
   * bottom sector, crew lines), and the merge depends on Y proximity.
   */
  y?: number;
}

/**
 * Format-agnostic intermediate that CSV, PDF, and future importers all
 * converge on. The single input type for the shared parser layer.
 */
export interface NormalizedDocument {
  /** Which extractor produced this document. */
  format: ImportFormat;
  /** Which eCrew report this is, sniffed from `rawText`. */
  reportType: DetectedKind;
  /** Normalized source rows, in document order. */
  rows: NormalizedRow[];
  /** Full reconstructed text. Used for whole-line regexes that don't map
   *  cleanly onto cells — the "Generated on …" footer and the header
   *  date-range line. */
  rawText: string;
  /** Original filename when available (diagnostics + UI chips). */
  fileName?: string;
}
