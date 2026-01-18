/**
 * OOOI Data Extractor - Layout-Aware Implementation
 *
 * Optimized for Airbus MCDU AOC VOYAGE RPT displays.
 * Uses bounding box geometry for reliable extraction.
 *
 * Target layout:
 *   DOOR CLS    OUT       (label row)
 *   0336        0340      (value row - OUT is right column)
 *   IN          TAXI
 *   0630        0345      (IN is left column)
 *   ON          OFF
 *   0626        0354      (ON left, OFF right)
 *   BLOCK       FLIGHT
 *   0250        0232      (BLOCK left, FLIGHT right)
 */

// ============================================
// Types
// ============================================

export interface OcrResult {
  text: string
  confidence: number
  box: number[][] // [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
}

export interface ExtractedFlightData {
  outTime?: string
  offTime?: string
  onTime?: string
  inTime?: string
  blockTime?: string
  flightTime?: string
  confidence: number
  rawText?: string
}

interface OcrRow {
  items: OcrResult[]
  midY: number
}

// ============================================
// Geometry Utilities
// ============================================

function getBoxMidY(box: number[][]): number {
  return (box[0][1] + box[2][1]) / 2
}

function getBoxMidX(box: number[][]): number {
  return (box[0][0] + box[1][0]) / 2
}

function getBoxHeight(box: number[][]): number {
  return Math.abs(box[2][1] - box[0][1])
}

/**
 * Calculate row tolerance based on median text height
 */
function calculateTolerance(results: OcrResult[]): number {
  if (results.length < 2) return 20

  const heights = results
    .map((r) => getBoxHeight(r.box))
    .filter((h) => h > 5)
    .sort((a, b) => a - b)

  if (heights.length === 0) return 20

  const median = heights[Math.floor(heights.length / 2)]
  return Math.max(median * 0.6, 15)
}

// ============================================
// Row Grouping
// ============================================

/**
 * Group OCR results into visual rows by Y-coordinate
 */
function groupIntoRows(results: OcrResult[], tolerance: number): OcrRow[] {
  const rows: OcrRow[] = []

  for (const item of results) {
    const midY = getBoxMidY(item.box)

    const existingRow = rows.find((r) => Math.abs(r.midY - midY) < tolerance)

    if (existingRow) {
      existingRow.items.push(item)
    } else {
      rows.push({ items: [item], midY })
    }
  }

  // Sort items within rows by X (left to right)
  for (const row of rows) {
    row.items.sort((a, b) => getBoxMidX(a.box) - getBoxMidX(b.box))
  }

  // Sort rows by Y (top to bottom)
  return rows.sort((a, b) => a.midY - b.midY)
}

/**
 * Get combined text from a row
 */
function getRowText(row: OcrRow): string {
  return row.items.map((i) => i.text.trim()).join(" ")
}

/**
 * Get left/right value from a row (for two-column layout)
 */
function getColumnValue(row: OcrRow, side: "left" | "right"): string | undefined {
  if (row.items.length >= 2) {
    return side === "left" ? row.items[0].text.trim() : row.items[row.items.length - 1].text.trim()
  }

  // Single item - try splitting by whitespace
  if (row.items.length === 1) {
    const parts = row.items[0].text.trim().split(/\s+/)
    if (parts.length >= 2) {
      return side === "left" ? parts[0] : parts[parts.length - 1]
    }
  }

  return undefined
}

// ============================================
// Time Parsing
// ============================================

/**
 * Format HHMM or HH:MM to HH:MM
 */
function formatTime(raw: string | undefined): string | undefined {
  if (!raw) return undefined

  // Remove leading 'A' (actual time prefix) and whitespace
  const cleaned = raw.replace(/^A/i, "").trim()

  // Match HHMM or HH:MM
  const match = cleaned.match(/^(\d{2}):?(\d{2})$/)
  if (!match) return undefined

  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return undefined
  }

  return `${match[1]}:${match[2]}`
}

/**
 * Check if string is valid HH:MM time
 */
function isValidTime(time: string | undefined): time is string {
  if (!time) return false
  return /^\d{2}:\d{2}$/.test(time)
}

/**
 * Convert HH:MM to minutes
 */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

/**
 * Calculate duration handling day rollover
 */
function getDuration(start: string, end: string): number {
  let startMins = toMinutes(start)
  let endMins = toMinutes(end)
  if (endMins < startMins) endMins += 1440
  return endMins - startMins
}

// ============================================
// Time Validation
// ============================================

/**
 * Validate OOOI times using physics-based logic
 */
function validateTimes(data: ExtractedFlightData): number {
  const { outTime, offTime, onTime, inTime, blockTime, flightTime } = data
  let score = 0

  // 1. Sequence check: OUT < OFF < ON < IN
  const times = [
    { name: "OUT", val: outTime },
    { name: "OFF", val: offTime },
    { name: "ON", val: onTime },
    { name: "IN", val: inTime },
  ].filter((t) => isValidTime(t.val))

  if (times.length >= 2) {
    let sequential = true
    for (let i = 1; i < times.length; i++) {
      const prev = toMinutes(times[i - 1].val!)
      let curr = toMinutes(times[i].val!)
      if (curr < prev) curr += 1440 // day rollover
      if (curr <= prev) sequential = false
    }
    if (sequential) score += 0.4
  }

  // 2. Block time check (OUT to IN)
  if (isValidTime(outTime) && isValidTime(inTime)) {
    const block = getDuration(outTime, inTime)
    if (block > 0 && block <= 1200) score += 0.15 // <= 20 hours
  }

  // 3. Flight time check (OFF to ON)
  if (isValidTime(offTime) && isValidTime(onTime)) {
    const flight = getDuration(offTime, onTime)
    if (flight > 0 && flight <= 1140) score += 0.15 // <= 19 hours
  }

  // 4. Taxi-out check (OUT to OFF): 3-120 min typical
  if (isValidTime(outTime) && isValidTime(offTime)) {
    const taxi = getDuration(outTime, offTime)
    if (taxi >= 3 && taxi <= 120) score += 0.1
  }

  // 5. Taxi-in check (ON to IN): 2-60 min typical
  if (isValidTime(onTime) && isValidTime(inTime)) {
    const taxi = getDuration(onTime, inTime)
    if (taxi >= 2 && taxi <= 60) score += 0.1
  }

  // 6. Verify computed times match
  if (isValidTime(blockTime) && isValidTime(outTime) && isValidTime(inTime)) {
    const computed = getDuration(outTime, inTime)
    const reported = toMinutes(blockTime)
    if (Math.abs(computed - reported) <= 2) score += 0.05
  }

  if (isValidTime(flightTime) && isValidTime(offTime) && isValidTime(onTime)) {
    const computed = getDuration(offTime, onTime)
    const reported = toMinutes(flightTime)
    if (Math.abs(computed - reported) <= 2) score += 0.05
  }

  return Math.min(1, score)
}

// ============================================
// Layout Extraction (Primary)
// ============================================

/**
 * Extract times using layout-aware geometry
 */
function extractFromLayout(results: OcrResult[]): ExtractedFlightData {
  const data: ExtractedFlightData = { confidence: 0 }

  if (results.length === 0) return data

  const tolerance = calculateTolerance(results)
  const rows = groupIntoRows(results, tolerance)

  // Store raw text for debugging
  data.rawText = rows.map(getRowText).join("\n")

  // Scan for label patterns and extract from next row
  for (let i = 0; i < rows.length - 1; i++) {
    const labelText = getRowText(rows[i]).toUpperCase()
    const valueRow = rows[i + 1]

    // "DOOR CLS" + "OUT" row → OUT is right column of next row
    if (/DOOR\s*CL[SO]?/.test(labelText) && /OUT/.test(labelText)) {
      const val = formatTime(getColumnValue(valueRow, "right"))
      if (val && !data.outTime) data.outTime = val
    }

    // "IN" + "TAXI" row → IN is left column of next row
    if (/\bIN\b/.test(labelText) && /TAXI/.test(labelText)) {
      const val = formatTime(getColumnValue(valueRow, "left"))
      if (val && !data.inTime) data.inTime = val
    }

    // "ON" + "OFF" row → ON left, OFF right of next row
    if (/\bON\b/.test(labelText) && /\bOFF\b/.test(labelText)) {
      const onVal = formatTime(getColumnValue(valueRow, "left"))
      const offVal = formatTime(getColumnValue(valueRow, "right"))
      if (onVal && !data.onTime) data.onTime = onVal
      if (offVal && !data.offTime) data.offTime = offVal
    }

    // "BLOCK" + "FLIGHT" row → times in next row
    if (/BLOCK/.test(labelText) && /FLIGHT/.test(labelText)) {
      const blockVal = formatTime(getColumnValue(valueRow, "left"))
      const flightVal = formatTime(getColumnValue(valueRow, "right"))
      if (blockVal && !data.blockTime) data.blockTime = blockVal
      if (flightVal && !data.flightTime) data.flightTime = flightVal
    }
  }

  data.confidence = validateTimes(data)
  return data
}

// ============================================
// String Extraction (Fallback)
// ============================================

/**
 * Extract times from concatenated text (fallback for poor OCR)
 */
function extractFromText(text: string): ExtractedFlightData {
  const data: ExtractedFlightData = { confidence: 0, rawText: text }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)

  for (let i = 0; i < lines.length - 1; i++) {
    const label = lines[i].toUpperCase()
    const values = lines[i + 1].match(/\b(\d{4})\b/g)
    if (!values) continue

    if (/DOOR/.test(label) && /OUT/.test(label) && values.length >= 2) {
      data.outTime = data.outTime || formatTime(values[1])
    }

    if (/\bIN\b/.test(label) && /TAXI/.test(label) && values.length >= 1) {
      data.inTime = data.inTime || formatTime(values[0])
    }

    if (/\bON\b/.test(label) && /\bOFF\b/.test(label) && values.length >= 2) {
      data.onTime = data.onTime || formatTime(values[0])
      data.offTime = data.offTime || formatTime(values[1])
    }

    if (/BLOCK/.test(label) && /FLIGHT/.test(label) && values.length >= 2) {
      data.blockTime = data.blockTime || formatTime(values[0])
      data.flightTime = data.flightTime || formatTime(values[1])
    }
  }

  data.confidence = validateTimes(data)
  return data
}

// ============================================
// Public API
// ============================================

/**
 * Extract flight data from OCR results
 *
 * Uses layout-aware extraction with string fallback
 */
export function extractFlightData(input: OcrResult[] | string): ExtractedFlightData {
  // String input → use text extraction
  if (typeof input === "string") {
    return extractFromText(input)
  }

  // Empty input
  if (input.length === 0) {
    return { confidence: 0 }
  }

  // Try layout extraction first
  const layoutResult = extractFromLayout(input)

  // If good confidence, return it
  if (layoutResult.confidence >= 0.5) {
    return layoutResult
  }

  // Fallback to text extraction
  const text = input.map((r) => r.text).join("\n")
  const textResult = extractFromText(text)

  // Return whichever is better
  return layoutResult.confidence >= textResult.confidence ? layoutResult : textResult
}

/**
 * Validate extracted data (for debugging)
 */
export function validateExtractedData(data: ExtractedFlightData): {
  score: number
  issues: string[]
} {
  const issues: string[] = []
  const { outTime, offTime, onTime, inTime } = data

  // Check sequence
  const times = [
    { name: "OUT", val: outTime },
    { name: "OFF", val: offTime },
    { name: "ON", val: onTime },
    { name: "IN", val: inTime },
  ].filter((t) => isValidTime(t.val))

  for (let i = 1; i < times.length; i++) {
    const prev = toMinutes(times[i - 1].val!)
    let curr = toMinutes(times[i].val!)
    if (curr < prev) curr += 1440
    if (curr <= prev) {
      issues.push(`${times[i].name} should be after ${times[i - 1].name}`)
    }
  }

  return { score: data.confidence, issues }
}
