/**
 * PDF text extraction API.
 *
 * The browser-side `pdfjs-dist` worker has been chronically unreliable in
 * the user's iOS Safari + PWA + service worker environment, so we just
 * run the extraction in Node where it's been verified to work
 * (see `scripts/smoke-test-pdf.mjs`). The client uploads the PDF binary,
 * the server returns CSV-shaped text identical to the browser-extracted
 * output that `logbook-parser-v2` / `schedule-parser` already consume.
 *
 * The extraction algorithm is intentionally a copy of the browser-side
 * pdf-extract.ts so both code paths produce identical output (anchored
 * to the report's header row's X-coordinates so empty cells in the
 * layout become empty strings in the CSV, matching the .csv export
 * column count exactly).
 */

import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsModule: any = null

async function loadPdfjs() {
  if (pdfjsModule) return pdfjsModule
  // The legacy build supports running in Node out of the box.
  pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs")
  return pdfjsModule
}

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  let buffer: ArrayBuffer
  try {
    buffer = await req.arrayBuffer()
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read uploaded bytes: ${(err as Error).message}` },
      { status: 400 }
    )
  }

  if (!buffer || buffer.byteLength === 0) {
    return NextResponse.json({ error: "No PDF bytes uploaded" }, { status: 400 })
  }

  let pdfjs: Awaited<ReturnType<typeof loadPdfjs>>
  try {
    pdfjs = await loadPdfjs()
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load pdfjs on the server: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  try {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) })
    const pdf = await loadingTask.promise
    if (!pdf || typeof pdf.numPages !== "number") {
      return NextResponse.json(
        { error: "Document load returned no pages" },
        { status: 422 }
      )
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
      return NextResponse.json(
        { error: "PDF has no extractable text — try the CSV export instead" },
        { status: 422 }
      )
    }

    return NextResponse.json({
      pages,
      fullText,
      pageCount: pages.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `PDF extraction failed: ${message}` },
      { status: 500 }
    )
  }
}
