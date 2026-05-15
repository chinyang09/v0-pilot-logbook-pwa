/**
 * Browser-side PDF text extraction.
 *
 * ecrew exports its Crew Logbook Report and Personal Crew Schedule Report
 * as native (text-layer) PDFs. The text-layer has no row/column structure,
 * just absolutely-positioned glyph runs. To produce a CSV the downstream
 * parser can consume, we:
 *
 *   1. Bucket items by Y-coordinate into rows.
 *   2. Find the row that looks like the column header
 *      ("Date,Airport,Time,…") and record the X-coordinate of each header
 *      token as a column anchor.
 *   3. For every data row, snap each item to the nearest column anchor and
 *      emit empty strings for anchors with no token nearby.
 *
 * The column-anchor step is the critical one — the previous gap-based
 * approach silently dropped empty cells, so a sparse logbook row like
 * "…,Chua Hock Leong,,1,,1,,02:32,,," (Night TO=1, Night LDG=1) came out
 * looking like "…,Chua Hock Leong,1,1,02:32" — three columns instead of
 * nine — and the parser then misread the night-takeoff "1" as a
 * day-takeoff.
 *
 * Scanned/image-only PDFs throw — the user is asked to use the CSV export.
 *
 * Worker setup:
 *   pdfjs-dist 5.x requires a live worker. We pre-create the Worker
 *   ourselves and hand it to pdfjs through GlobalWorkerOptions.workerPort
 *   so the URL resolution can't be tripped up by Webpack bundling or the
 *   app's service worker. The worker file lives in
 *   `public/workers/pdf.worker.min.mjs` (committed, refreshed by
 *   `scripts/copy-pdf-worker.mjs` on dev/build/postinstall).
 */

const WORKER_PATH = "/workers/pdf.worker.min.mjs";

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
/** Half-width tolerance for snapping a data-row item to a header column. */
const COL_SNAP_TOLERANCE = 25;

/** Tokens we look for to identify the column header row(s). */
const HEADER_TOKENS = new Set([
  "Date",
  "Airport",
  "Time",
  "Type",
  "Reg.",
  "Flt time",
  "Name PIC",
  "Day",
  "Night",
  "PIC",
  "Co-Plt",
  "Instr",
  "Duties",
  "Details",
  "Report times",
  "Actual times/Delays",
  "Debrief times",
  "Indicators",
  "Crew",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsCached: any = null;
let workerSetupPromise: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setupWorker(pdfjs: any): Promise<void> {
  const opts = pdfjs.GlobalWorkerOptions;
  if (!opts) {
    throw new Error("pdfjs.GlobalWorkerOptions is not available");
  }
  // @ts-expect-error workerPort exists in 5.x types
  if (opts.workerPort || opts.workerSrc) return;

  const absoluteUrl = new URL(
    WORKER_PATH,
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost"
  ).href;

  // Preferred: pre-create a module Worker and hand it to pdfjs.
  try {
    if (typeof Worker !== "undefined") {
      const worker = new Worker(absoluteUrl, { type: "module" });
      // @ts-expect-error workerPort is the recommended modern entrypoint
      opts.workerPort = worker;
      return;
    }
  } catch (err) {
    console.warn(
      "[pdf] workerPort setup via static URL failed, falling back to Blob URL:",
      err
    );
  }

  // Fallback: fetch the worker code and spawn the Worker from a Blob URL.
  // Sidesteps service-worker interception, CSP quirks, and bundler oddities.
  try {
    const res = await fetch(WORKER_PATH);
    if (!res.ok) throw new Error(`worker fetch ${res.status}`);
    const code = await res.text();
    const blob = new Blob([code], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    const worker = new Worker(blobUrl, { type: "module" });
    // @ts-expect-error workerPort is the recommended modern entrypoint
    opts.workerPort = worker;
  } catch (err) {
    // Final fallback: let pdfjs resolve workerSrc itself. The error
    // message from pdfjs is more informative than a black-box "t of e".
    opts.workerSrc = absoluteUrl;
    console.error("[pdf] all worker setup paths failed", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPdfjs(): Promise<any> {
  if (pdfjsCached) {
    if (workerSetupPromise) await workerSetupPromise;
    return pdfjsCached;
  }
  try {
    pdfjsCached = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (err) {
    throw new Error(
      `[pdf] failed to load pdfjs-dist module: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  workerSetupPromise = setupWorker(pdfjsCached).catch((err) => {
    throw new Error(
      `[pdf] worker setup failed: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  await workerSetupPromise;
  return pdfjsCached;
}

interface Row {
  y: number;
  items: TextItemLike[];
}

function bucketRows(items: TextItemLike[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    if (!item || typeof item.str !== "string" || !Array.isArray(item.transform)) {
      continue;
    }
    const y = item.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < Y_BUCKET_TOLERANCE);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.transform[4] - b.transform[4]);
  }
  return rows.sort((a, b) => b.y - a.y); // top-to-bottom (descending Y)
}

/**
 * Look for a row whose tokens include at least 3 known header words. The
 * Crew Logbook Report's data header is the row containing "Date", "Airport",
 * "Time", etc.; the Schedule Report's header is "Date", "Duties", "Details",
 * etc. We just want anchors for the columns the parser will care about.
 */
function findHeaderColumns(rows: Row[]): number[] {
  for (const row of rows) {
    const tokens = row.items
      .map((i) => i.str.trim())
      .filter((s) => s.length > 0);
    let hits = 0;
    for (const t of tokens) {
      if (HEADER_TOKENS.has(t)) hits++;
    }
    if (hits >= 3) {
      // Return X coords of every non-empty token in this row.
      return row.items
        .filter((i) => i.str.trim().length > 0)
        .map((i) => i.transform[4]);
    }
  }
  return [];
}

/**
 * Snap one data row's items into a CSV line keyed off the header anchors.
 * Items beyond the last anchor (or before the first) are appended/prepended
 * verbatim so we don't lose data near the edges. When two items map to the
 * same anchor (because one is a wider phrase like a name), they're joined
 * with a space — same behaviour as the previous gap-based logic.
 */
function rowToCsv(row: Row, anchors: number[]): string {
  if (anchors.length === 0) {
    // No header detected on this page; fall back to gap-based join.
    return gapJoinRow(row);
  }

  const cells: string[] = anchors.map(() => "");
  const preAnchor: string[] = [];
  const postAnchor: string[] = [];
  const firstAnchor = anchors[0];
  const lastAnchor = anchors[anchors.length - 1];

  for (const item of row.items) {
    const text = item.str.trim();
    if (!text) continue;
    const x = item.transform[4];

    if (x < firstAnchor - COL_SNAP_TOLERANCE) {
      preAnchor.push(text);
      continue;
    }
    if (x > lastAnchor + COL_SNAP_TOLERANCE) {
      postAnchor.push(text);
      continue;
    }

    // Find the nearest anchor.
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(anchors[i] - x);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestDist > COL_SNAP_TOLERANCE) {
      // Equidistant to no anchor → assign to the column to its left
      // (i.e., the previous anchor) so widening text doesn't drift right.
      bestIdx = 0;
      for (let i = 0; i < anchors.length; i++) {
        if (anchors[i] <= x) bestIdx = i;
      }
    }
    cells[bestIdx] = cells[bestIdx] ? `${cells[bestIdx]} ${text}` : text;
  }

  const out: string[] = [];
  if (preAnchor.length) out.push(preAnchor.join(" "));
  out.push(...cells);
  if (postAnchor.length) out.push(postAnchor.join(" "));
  return out.join(",");
}

function gapJoinRow(row: Row): string {
  let line = "";
  let prevRight = -Infinity;
  for (const item of row.items) {
    const text = item.str.trim();
    if (!text) continue;
    const left = item.transform[4];
    const right = left + (item.width ?? 0);
    if (line === "") {
      line = text;
    } else {
      const gap = left - prevRight;
      if (gap > 4) line += "," + text;
      else if (gap > 0.5) line += " " + text;
      else line += text;
    }
    prevRight = right;
  }
  return line;
}

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = await loadPdfjs();
  } catch (err) {
    throw err;
  }

  if (typeof pdfjs.getDocument !== "function") {
    throw new Error(
      "[pdf] pdfjs.getDocument is unavailable — module exports may be wrong"
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    throw new Error(
      `[pdf] failed to read file bytes: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
    });
    pdf = await loadingTask.promise;
  } catch (err) {
    throw new Error(
      `[pdf] getDocument/parse failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!pdf || typeof pdf.numPages !== "number") {
    throw new Error("[pdf] document load returned no pages");
  }

  const pages: string[] = [];
  let columnAnchors: number[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    let page;
    let content;
    try {
      page = await pdf.getPage(pageNum);
      content = await page.getTextContent();
    } catch (err) {
      throw new Error(
        `[pdf] page ${pageNum} text extraction failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const items = (content?.items ?? []) as TextItemLike[];
    if (!Array.isArray(items) || items.length === 0) {
      pages.push("");
      continue;
    }

    const rows = bucketRows(items);

    // Each page might re-print the header. Re-derive anchors if we find
    // one on this page; otherwise reuse the previous page's anchors.
    const pageAnchors = findHeaderColumns(rows);
    if (pageAnchors.length > 0) columnAnchors = pageAnchors;

    const lines = rows.map((row) => rowToCsv(row, columnAnchors)).filter(Boolean);
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
