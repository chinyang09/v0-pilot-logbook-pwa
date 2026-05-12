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
 * Worker setup:
 *   pdfjs-dist 5.x requires a live worker; the v4 fake-worker fallback is
 *   gone. We pre-create the Worker ourselves via `new Worker(url, { type:
 *   "module" })` and hand it to pdfjs through `GlobalWorkerOptions
 *   .workerPort`. This is more robust than letting pdfjs resolve the URL
 *   itself, which has historically tripped on Next.js webpack bundling,
 *   the app's service worker, and various MIME quirks.
 *
 *   The worker file is copied into `public/workers/pdf.worker.min.mjs`
 *   by `scripts/copy-pdf-worker.mjs` (postinstall + dev + build).
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsCached: any = null;
let workerSetupPromise: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setupWorker(pdfjs: any): Promise<void> {
  // pdfjs.GlobalWorkerOptions is shared global state — only set up once.
  const opts = pdfjs.GlobalWorkerOptions;
  if (!opts) {
    throw new Error("pdfjs.GlobalWorkerOptions is not available");
  }
  // Already configured (re-import).
  // @ts-expect-error workerPort exists in 5.x types
  if (opts.workerPort || opts.workerSrc) return;

  const absoluteUrl = new URL(
    WORKER_PATH,
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost"
  ).href;

  // Preferred: create a module Worker ourselves and hand it to pdfjs.
  // Avoids letting pdfjs's internal resolver fight Next.js's bundler or
  // the app's service worker.
  try {
    if (typeof Worker !== "undefined") {
      const worker = new Worker(absoluteUrl, { type: "module" });
      // @ts-expect-error - workerPort is the recommended modern entrypoint
      opts.workerPort = worker;
      return;
    }
  } catch (err) {
    console.warn(
      "[pdf] workerPort setup failed, falling back to workerSrc:",
      err
    );
  }

  // Last resort: blob-URL the worker code so the import path doesn't
  // matter (handles service-worker quirks and cross-origin oddities).
  try {
    const res = await fetch(WORKER_PATH);
    if (!res.ok) {
      throw new Error(`worker fetch ${res.status}`);
    }
    const code = await res.text();
    const blob = new Blob([code], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    // Pre-create the Worker so pdfjs doesn't re-resolve the URL.
    const worker = new Worker(blobUrl, { type: "module" });
    // @ts-expect-error - workerPort is the recommended modern entrypoint
    opts.workerPort = worker;
  } catch (err) {
    // Give up — fall through and let pdfjs try workerSrc, which will
    // surface a more descriptive error from pdfjs itself.
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
    // Use the LEGACY build for the main library too — same reason as the
    // worker: better browser/PWA compatibility, more permissive worker
    // initialization, and a clearer error surface when something goes wrong.
    pdfjsCached = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (err) {
    throw new Error(
      `[pdf] failed to load pdfjs-dist module: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  workerSetupPromise = setupWorker(pdfjsCached).catch((err) => {
    // Re-throw with context so callers see a useful message rather than the
    // raw worker init error.
    throw new Error(
      `[pdf] worker setup failed: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  await workerSetupPromise;
  return pdfjsCached;
}

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = await loadPdfjs();
  } catch (err) {
    // loadPdfjs already wrapped its own errors.
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

    // Bucket by Y. PDF coordinate system is bottom-up (higher Y = higher on
    // page), so we sort rows in descending Y order to read top-to-bottom.
    const rows: { y: number; items: TextItemLike[] }[] = [];
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
