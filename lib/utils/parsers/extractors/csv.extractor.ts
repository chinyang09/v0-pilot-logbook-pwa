/**
 * Delimited-text extractor — turns raw CSV/TSV text into normalized rows.
 *
 * No field parsing happens here: it only does quote-aware row + cell
 * splitting (the same `splitCsvRows` / `parseCSVLine` the parsers used to
 * call inline). Blank lines are dropped by `splitCsvRows`, so a row's index
 * matches the legacy 1-based source line number as `index + 1`.
 *
 * The delimiter is SNIFFED from the header line rather than assumed, because
 * LogTen Pro's exports are tab-separated `.txt` files while eCrew's are
 * comma-separated `.csv`. `sniffDelimiter` only leaves comma when another
 * candidate genuinely beats it on the header, so eCrew files are unaffected.
 */

import {
  splitCsvRows,
  splitDelimitedLine,
  sniffDelimiter,
} from "../shared/csv-split";
import type { NormalizedRow } from "../types";

export function extractCsvRows(text: string): {
  rows: NormalizedRow[];
  rawText: string;
  delimiter: string;
} {
  const delimiter = sniffDelimiter(text);
  const rows = splitCsvRows(text).map((raw, index) => ({
    index,
    raw,
    cells: splitDelimitedLine(raw, delimiter),
  }));
  return { rows, rawText: text, delimiter };
}
