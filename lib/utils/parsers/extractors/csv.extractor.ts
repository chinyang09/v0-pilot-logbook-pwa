/**
 * CSV extractor — turns raw CSV text into normalized rows.
 *
 * No field parsing happens here: it only does quote-aware row + cell
 * splitting (the same `splitCsvRows` / `parseCSVLine` the parsers used to
 * call inline). Blank lines are dropped by `splitCsvRows`, so a row's index
 * matches the legacy 1-based source line number as `index + 1`.
 */

import { splitCsvRows, parseCSVLine } from "../shared/csv-split";
import type { NormalizedRow } from "../types";

export function extractCsvRows(text: string): {
  rows: NormalizedRow[];
  rawText: string;
} {
  const rows = splitCsvRows(text).map((raw, index) => ({
    index,
    raw,
    cells: parseCSVLine(raw),
  }));
  return { rows, rawText: text };
}
