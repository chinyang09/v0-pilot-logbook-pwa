/**
 * Client-side PDF text extraction.
 *
 * Runs unpdf's worker-free build of PDF.js directly in the browser, so PDF
 * import works fully offline — no API route, no network round-trip. Every
 * prior approach failed on PDF.js's worker machinery (iOS Safari + service
 * worker on the client; fake-worker module resolution on the server). unpdf
 * runs PDF.js on the main thread with no separate worker file, removing that
 * whole failure class.
 *
 * unpdf is loaded via dynamic import so its ~1 MB chunk stays out of the
 * initial bundle and only loads on the first PDF import (then the service
 * worker's _next/static runtime cache keeps it available offline).
 *
 * Emits CSV-shaped text identical to the report's .csv export: tokens are
 * snapped to the header row's X-anchors, so an empty cell in the PDF layout
 * becomes an empty cell in the CSV. That preserves the night-takeoff vs
 * night-landing distinction the downstream parser depends on.
 */

export interface PdfExtractResult {
  /** Per-page rendered text — each page is its own CSV-shaped string. */
  pages: string[]
  /** Concatenation of pages joined by "\n". */
  fullText: string
  pageCount: number
}

const Y_BUCKET_TOLERANCE = 1.5
const COL_SNAP_TOLERANCE = 25
const HEADER_TOKENS = new Set<string>([
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
])

interface TextItem {
  str: string
  transform: number[]
  width?: number
}

interface Row {
  y: number
  items: TextItem[]
}

// Minimal structural typings for the bits of the PDF.js proxy we touch, so
// this file doesn't depend on unpdf re-exporting PDF.js types.
interface PdfPageProxy {
  getTextContent: () => Promise<{ items: unknown[] }>
}
interface PdfDocumentProxy {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPageProxy>
}
type GetDocumentProxy = (
  data: Uint8Array,
) => Promise<PdfDocumentProxy>

function bucketRows(items: TextItem[]): Row[] {
  const rows: Row[] = []
  for (const item of items) {
    if (!item || typeof item.str !== "string" || !Array.isArray(item.transform)) {
      continue
    }
    const y = item.transform[5]
    let row = rows.find((r) => Math.abs(r.y - y) < Y_BUCKET_TOLERANCE)
    if (!row) {
      row = { y, items: [] }
      rows.push(row)
    }
    row.items.push(item)
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.transform[4] - b.transform[4])
  }
  return rows.sort((a, b) => b.y - a.y)
}

function findHeaderColumns(rows: Row[]): number[] {
  for (const row of rows) {
    const tokens = row.items.map((i) => i.str.trim()).filter(Boolean)
    let hits = 0
    for (const t of tokens) {
      if (HEADER_TOKENS.has(t)) hits++
    }
    if (hits >= 3) {
      return row.items.filter((i) => i.str.trim().length > 0).map((i) => i.transform[4])
    }
  }
  return []
}

function gapJoinRow(row: Row): string {
  let line = ""
  let prevRight = -Infinity
  for (const item of row.items) {
    const text = item.str.trim()
    if (!text) continue
    const left = item.transform[4]
    const right = left + (item.width ?? 0)
    if (line === "") {
      line = text
    } else {
      const gap = left - prevRight
      if (gap > 4) line += "," + text
      else if (gap > 0.5) line += " " + text
      else line += text
    }
    prevRight = right
  }
  return line
}

function rowToCsv(row: Row, anchors: number[]): string {
  if (anchors.length === 0) return gapJoinRow(row)
  const cells: string[] = anchors.map(() => "")
  const preAnchor: string[] = []
  const postAnchor: string[] = []
  const firstAnchor = anchors[0]
  const lastAnchor = anchors[anchors.length - 1]
  for (const item of row.items) {
    const text = item.str.trim()
    if (!text) continue
    const x = item.transform[4]
    if (x < firstAnchor - COL_SNAP_TOLERANCE) {
      preAnchor.push(text)
      continue
    }
    if (x > lastAnchor + COL_SNAP_TOLERANCE) {
      postAnchor.push(text)
      continue
    }
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(anchors[i] - x)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    if (bestDist > COL_SNAP_TOLERANCE) {
      bestIdx = 0
      for (let i = 0; i < anchors.length; i++) if (anchors[i] <= x) bestIdx = i
    }
    cells[bestIdx] = cells[bestIdx] ? `${cells[bestIdx]} ${text}` : text
  }
  const out: string[] = []
  if (preAnchor.length) out.push(preAnchor.join(" "))
  out.push(...cells)
  if (postAnchor.length) out.push(postAnchor.join(" "))
  return out.join(",")
}

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch (err) {
    throw new Error(
      `[pdf] failed to read file bytes: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let getDocumentProxy: GetDocumentProxy
  try {
    const mod = (await import("unpdf")) as { getDocumentProxy: GetDocumentProxy }
    getDocumentProxy = mod.getDocumentProxy
  } catch (err) {
    throw new Error(
      `[pdf] failed to load the PDF engine: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    if (!pdf || typeof pdf.numPages !== "number") {
      throw new Error("document load returned no pages")
    }

    const pages: string[] = []
    let anchors: number[] = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const items = (content?.items ?? []) as TextItem[]
      if (!Array.isArray(items) || items.length === 0) {
        pages.push("")
        continue
      }
      const rows = bucketRows(items)
      const pageAnchors = findHeaderColumns(rows)
      if (pageAnchors.length > 0) anchors = pageAnchors
      const lines = rows.map((r) => rowToCsv(r, anchors)).filter(Boolean)
      pages.push(lines.join("\n"))
    }

    const fullText = pages.join("\n")
    if (fullText.length === 0) {
      throw new Error("PDF has no extractable text — try the CSV export instead")
    }

    return { pages, fullText, pageCount: pages.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message.startsWith("[pdf]") ? message : `[pdf] ${message}`)
  }
}
