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

export function parseCSVLine(line: string): string[] {
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
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map((s) => s.replace(/^"|"$/g, "").trim());
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
