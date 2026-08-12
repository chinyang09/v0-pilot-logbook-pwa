/**
 * Header normalisation for LogTen Pro exports.
 *
 * A LogTen export is addressed BY NAME, never by column index. There are two
 * good reasons and one hard one:
 *
 *  - the Flights tab is ~280 columns wide and the set depends on which
 *    fields the user has enabled, so index 40 is `flight_totalTime` in this
 *    export and something else in the next one;
 *  - LogTen ships two naming styles — internal property names in the Flights
 *    tab (`flight_totalTime`) and human labels elsewhere (`Aircraft ID`) —
 *    and a user can re-save either through a spreadsheet, which re-cases and
 *    re-spaces the labels;
 *  - and the header itself is dirty: several columns arrive with a leading
 *    space (` flight_from`, ` Full Name`, ` Type`).
 *
 * So every name is reduced to a KEY — lowercase, alphanumerics only — and a
 * field is looked up through a list of aliases in both styles. `flight_from`,
 * ` Flight From `, and `Flight  From` all key to `flightfrom`.
 *
 * Duplicate columns are real: the Aircraft export has TWO "Notes" (the
 * aircraft's and the type's). The first occurrence keeps the bare key; later
 * ones get `key#2`, `key#3`, so a caller can still reach them and neither is
 * silently lost.
 */

import { text } from "./values";

/** Lowercase, alphanumerics only. The single canonical form of a column name. */
export function headerKey(raw: string): string {
  return text(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface HeaderIndex {
  /** Canonical key → column position. */
  byKey: Map<string, number>;
  /** The header row exactly as it appeared, for diagnostics. */
  original: string[];
  /** Column count — a row with fewer cells is short, not corrupt. */
  width: number;
}

export function buildHeaderIndex(headerCells: string[]): HeaderIndex {
  const byKey = new Map<string, number>();
  headerCells.forEach((cell, index) => {
    const key = headerKey(cell);
    if (!key) return;
    if (!byKey.has(key)) {
      byKey.set(key, index);
      return;
    }
    // Duplicate label (the Aircraft export's two "Notes" columns). Keep both.
    for (let n = 2; n < 50; n++) {
      const suffixed = `${key}#${n}`;
      if (!byKey.has(suffixed)) {
        byKey.set(suffixed, index);
        return;
      }
    }
  });
  return { byKey, original: headerCells, width: headerCells.length };
}

/**
 * A row bound to its header, read through field aliases.
 *
 * `get` returns the first alias that resolves to a NON-EMPTY cell, so a file
 * carrying both `flight_from` and a human `From` column reads correctly
 * whichever one the user actually populated.
 */
export class LogtenRow {
  constructor(
    private readonly header: HeaderIndex,
    private readonly cells: string[],
    /** 1-based line number in the source file, for diagnostics. */
    readonly sourceLine: number
  ) {}

  /** Raw cell text for the first alias that has one. */
  get(...aliases: string[]): string {
    for (const alias of aliases) {
      const index = this.header.byKey.get(headerKey(alias));
      if (index == null) continue;
      const value = text(this.cells[index]);
      if (value) return value;
    }
    return "";
  }

  /** True when the file carries at least one of these columns at all. */
  has(...aliases: string[]): boolean {
    return aliases.some((alias) => this.header.byKey.has(headerKey(alias)));
  }

  /** Every populated cell, for the "is this row empty?" test. */
  get populatedCount(): number {
    let count = 0;
    for (const cell of this.cells) if (text(cell)) count++;
    return count;
  }

  get raw(): string[] {
    return this.cells;
  }
}

/**
 * Split a normalized document's rows into a header index plus data rows.
 *
 * The header is the first row that resolves at least `minColumns` distinct
 * keys — not simply row 0 — so a stray blank or a title line above the table
 * doesn't become the header. LogTen has no preamble today, but a
 * spreadsheet round-trip is exactly what adds one.
 *
 * Rows with no populated cells are dropped here, so no downstream parser has
 * to think about them.
 */
export function bindRows(
  rows: Array<{ cells: string[]; index: number }>,
  minColumns = 3
): { header: HeaderIndex; dataRows: LogtenRow[] } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const header = buildHeaderIndex(rows[i].cells);
    if (header.byKey.size < minColumns) continue;

    const dataRows: LogtenRow[] = [];
    for (let r = i + 1; r < rows.length; r++) {
      const row = new LogtenRow(header, rows[r].cells, rows[r].index + 1);
      if (row.populatedCount === 0) continue;
      dataRows.push(row);
    }
    return { header, dataRows };
  }
  return null;
}
