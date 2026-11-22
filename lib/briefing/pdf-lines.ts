/**
 * A briefing PDF as LINES OF TEXT, page by page, with its columns kept as
 * spaces — the company's OFP is a monospaced print, and the parser reads it
 * the way a pilot does, by line and by column.
 *
 * The same worker-free PDF.js the schedule import uses (`unpdf`, loaded on
 * demand, so it runs offline in the browser and in a test). Each text item
 * sits at an x and a y; items on one baseline are one line, and the gap
 * between two items becomes as many spaces as the page's own character width
 * says it is (`charWidth`, measured off the page's items), so "WSSS/02L
 * CAT1DME" keeps its columns. A page that is a picture (the airport charts
 * at the end) has no text and comes back empty.
 */

interface TextItem {
  str: string
  transform: number[]
  width?: number
}

interface PdfPageProxy {
  getTextContent: () => Promise<{ items: unknown[] }>
}
interface PdfDocumentProxy {
  numPages: number
  getPage: (n: number) => Promise<PdfPageProxy>
}

const Y_TOLERANCE = 1.5

/** The width of one character on this page — the median over its items. */
function charWidth(items: TextItem[]): number {
  const widths = items
    .filter((i) => i.str.length >= 3 && (i.width ?? 0) > 0)
    .map((i) => (i.width ?? 0) / i.str.length)
    .sort((a, b) => a - b)
  return widths.length ? widths[Math.floor(widths.length / 2)] : 5
}

/** One page's items as lines, top to bottom, the gaps as spaces. */
export function itemsToLines(raw: unknown[]): string[] {
  const items = raw.filter(
    (i): i is TextItem => !!i && typeof (i as TextItem).str === "string" && Array.isArray((i as TextItem).transform),
  )
  if (items.length === 0) return []
  const cw = charWidth(items)
  const rows: { y: number; items: TextItem[] }[] = []
  for (const item of items) {
    if (!item.str) continue
    const y = item.transform[5]
    let row = rows.find((r) => Math.abs(r.y - y) < Y_TOLERANCE)
    if (!row) {
      row = { y, items: [] }
      rows.push(row)
    }
    row.items.push(item)
  }
  rows.sort((a, b) => b.y - a.y)
  // The page's left margin, so a line's indent is measured from it.
  const left = Math.min(...items.filter((i) => i.str.trim()).map((i) => i.transform[4]))
  return rows.map((row) => {
    row.items.sort((a, b) => a.transform[4] - b.transform[4])
    let line = ""
    for (const item of row.items) {
      const col = Math.max(0, Math.round((item.transform[4] - left) / cw))
      if (line.length < col) line += " ".repeat(col - line.length)
      else if (line.length && !line.endsWith(" ") && !item.str.startsWith(" ")) line += " "
      line += item.str
    }
    return line.replace(/\s+$/, "")
  })
}

/** Every page of a PDF as lines — or only its first `maxPages`, to tell what it is. */
export async function pdfToPages(data: Uint8Array, maxPages = Infinity): Promise<string[][]> {
  const mod = (await import("unpdf")) as { getDocumentProxy: (d: Uint8Array) => Promise<PdfDocumentProxy> }
  // PDF.js takes the buffer over; a copy leaves the caller's intact for a second read.
  const pdf = await mod.getDocumentProxy(data.slice())
  const pages: string[][] = []
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    pages.push(itemsToLines(content.items))
  }
  return pages
}
