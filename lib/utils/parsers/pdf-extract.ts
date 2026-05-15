/**
 * Browser-side PDF text extraction — server-delegated.
 *
 * Running pdfjs-dist in the browser turned out to be a Sisyphean fight
 * with iOS Safari + the app's service worker + module workers + CSP +
 * Webpack bundling. Every fix exposed a different layer of the stack.
 *
 * pdfjs runs fine in Node, however (verified by
 * `scripts/smoke-test-pdf.mjs` against a real Crew Logbook Report
 * PDF), so we just POST the PDF bytes to `/api/parse-pdf` and let the
 * server return the same CSV-shaped text the browser code used to
 * produce. The downstream parsers (`logbook-parser-v2`,
 * `schedule-parser`, `detect`) consume it unchanged.
 */

export interface PdfExtractResult {
  /** Per-page rendered text — each page is its own CSV-shaped string. */
  pages: string[]
  /** Concatenation of pages joined by "\n". */
  fullText: string
  pageCount: number
}

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch (err) {
    throw new Error(
      `[pdf] failed to read file bytes: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  let response: Response
  try {
    response = await fetch("/api/parse-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: buffer,
    })
  } catch (err) {
    throw new Error(
      `[pdf] could not reach /api/parse-pdf — check your connection. ` +
        `(${err instanceof Error ? err.message : String(err)})`
    )
  }

  let payload: { pages?: string[]; fullText?: string; pageCount?: number; error?: string }
  try {
    payload = await response.json()
  } catch (err) {
    throw new Error(
      `[pdf] server returned a non-JSON response (HTTP ${response.status}): ` +
        `${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!response.ok) {
    throw new Error(
      payload?.error
        ? `[pdf] ${payload.error}`
        : `[pdf] server returned HTTP ${response.status}`
    )
  }

  if (
    !payload ||
    !Array.isArray(payload.pages) ||
    typeof payload.fullText !== "string" ||
    typeof payload.pageCount !== "number"
  ) {
    throw new Error("[pdf] server returned an unexpected payload shape")
  }

  return {
    pages: payload.pages,
    fullText: payload.fullText,
    pageCount: payload.pageCount,
  }
}
