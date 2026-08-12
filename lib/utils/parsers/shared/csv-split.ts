/**
 * Quote-aware CSV row + line splitting shared by all parsers.
 */

export function splitCsvRows(csvContent: string): string[] {
  const rows: string[] = [];
  let currentRow = "";
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    if (char === '"') inQuotes = !inQuotes;
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (currentRow.trim()) rows.push(currentRow);
      currentRow = "";
    } else {
      currentRow += char;
    }
  }
  if (currentRow.trim()) rows.push(currentRow);
  return rows;
}

/**
 * Quote-aware split of one row into cells on an arbitrary delimiter.
 *
 * The delimiter is a parameter because not every export is comma-separated:
 * LogTen Pro's "Export …" writes TAB-separated files (and a LogTen remarks
 * field routinely contains commas, so re-splitting one of those on `,` would
 * shred the row). eCrew's CSVs keep the default.
 */
export function splitDelimitedLine(line: string, delimiter = ","): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map((s) => s.replace(/^"|"$/g, "").trim());
}

export function parseCSVLine(line: string): string[] {
  return splitDelimitedLine(line, ",");
}

/**
 * Which delimiter a delimited-text file uses, decided on its FIRST non-empty
 * line (the header) rather than on the whole file.
 *
 * A header row is the one line guaranteed to have every column present and no
 * free-text values, so it gives the cleanest count. Counting over the body
 * instead lets a single remarks cell full of commas outvote 280 real tabs.
 *
 * Comma is the default and only loses when another candidate BEATS it, so
 * every existing eCrew CSV keeps its current behaviour.
 */
export function sniffDelimiter(text: string): string {
  const header = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = countOutsideQuotes(header, ",");
  for (const candidate of candidates) {
    if (candidate === ",") continue;
    const count = countOutsideQuotes(header, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === delimiter && !inQuotes) count++;
  }
  return count;
}

export function parseDDMMYYYY(dateStr: string): string {
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return "";
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

export function parseDDMMYY(dateStr: string): string {
  const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!match) return "";
  const [, dd, mm, yy] = match;
  const yyyy = parseInt(yy, 10) >= 70 ? `19${yy}` : `20${yy}`;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}
