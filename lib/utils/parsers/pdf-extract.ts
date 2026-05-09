/**
 * Browser-side PDF text extraction.
 *
 * ecrew exports its Crew Logbook Report and Personal Crew Schedule Report
 * as native (text-layer) PDFs. We bucket text items by Y-coordinate into
 * rows, sort within each row by X-coord, and join with commas so the
 * downstream CSV parsers can reuse their column logic with minimal change.
 *
 * Scanned/image-only PDFs throw — the user is asked to use the CSV export.
 *
 * pdfjs-dist 5.x requires a worker URL. We bundle the worker into
 * `public/workers/pdf.worker.min.mjs` via `scripts/copy-pdf-worker.mjs`
 * (run on dev/build/postinstall) so the URL is stable and offline-safe.
 */

const WORKER_URL = "/workers/pdf.worker.min.mjs";

interface TextItemLike {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
}

export interface PdfExtractResult {
  /** Per-page rendered text — each page is its own CSV-shaped string. */
  pages: string[];
  /** Concatenation of pages joined by "\n". */
  fullText: string;
  pageCount: number;
}

const Y_BUCKET_TOLERANCE = 1.5;

let workerConfigured = false;

async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
    workerConfigured = true;
  }
  return pdfjs;
}

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  const pdfjs = await loadPdfjs();

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
  });
  const pdf = await loadingTask.promise;

  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = (content.items ?? []) as TextItemLike[];

    if (items.length === 0) {
      pages.push("");
      continue;
    }

    // Bucket by Y. PDF coordinate system is bottom-up (higher Y = higher on
    // page), so we sort rows in descending Y order to read top-to-bottom.
    const rows: { y: number; items: TextItemLike[] }[] = [];
    for (const item of items) {
      if (!item || !item.str || !item.transform) continue;
      const y = item.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < Y_BUCKET_TOLERANCE);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    }

    rows.sort((a, b) => b.y - a.y);

    const lines: string[] = [];
    for (const row of rows) {
      // Sort tokens left-to-right by their X coordinate.
      row.items.sort((a, b) => a.transform[4] - b.transform[4]);

      let line = "";
      let prevRight = -Infinity;
      for (const item of row.items) {
        const left = item.transform[4];
        const right = left + (item.width ?? 0);
        const text = item.str.trim();
        if (!text) continue;

        if (line === "") {
          line = text;
        } else {
          const gap = left - prevRight;
          if (gap > 4) {
            line += "," + text;
          } else if (gap > 0.5) {
            line += " " + text;
          } else {
            line += text;
          }
        }
        prevRight = right;
      }
      if (line) lines.push(line);
    }

    pages.push(lines.join("\n"));
  }

  const totalChars = pages.reduce((n, p) => n + p.length, 0);
  if (totalChars === 0) {
    throw new Error(
      "PDF has no extractable text — try the CSV export instead"
    );
  }

  return {
    pages,
    fullText: pages.join("\n"),
    pageCount: pages.length,
  };
}
