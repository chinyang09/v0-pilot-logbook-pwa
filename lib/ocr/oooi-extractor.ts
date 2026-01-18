/**
 * OOOI Time Extractor
 *
 * Extracts OUT, OFF, ON, IN times from raw OCR results.
 * Designed to work with AOC VOYAGE report format where labels
 * appear on one line and corresponding times on the next.
 */

import type { OcrTextResult } from './ocr-service'

export interface OOOITimes {
  outTime?: string // HH:MM format
  offTime?: string // HH:MM format
  onTime?: string // HH:MM format
  inTime?: string // HH:MM format
  confidence: number // Overall extraction confidence (0-1)
}

/**
 * Extract OOOI times from raw OCR results
 *
 * The AOC VOYAGE report format shows:
 * - "DOOR CLS OUT" followed by "0336 0340" (door close time, out time)
 * - "ON OFF" followed by "0626 0354" (on time, off time)
 * - "IN TAXI" followed by "0630 0345" (in time, taxi time)
 */
export function extractOOOITimes(ocrResults: OcrTextResult[]): OOOITimes {
  const result: OOOITimes = {
    confidence: 0,
  }

  if (!ocrResults || ocrResults.length === 0) {
    return result
  }

  // Sort by Y coordinate (top of bounding box) to process in reading order
  const sortedResults = [...ocrResults].sort((a, b) => {
    const aY = Math.min(...a.box.map(p => p[1]))
    const bY = Math.min(...b.box.map(p => p[1]))
    return aY - bY
  })

  // Build a list of text lines for sequential processing
  const lines = sortedResults.map(r => ({
    text: r.text.toUpperCase().trim(),
    confidence: r.mean,
  }))

  // Track which times we've found for confidence calculation
  let foundCount = 0
  let totalConfidence = 0

  // Process lines sequentially looking for label-value pairs
  for (let i = 0; i < lines.length - 1; i++) {
    const currentLine = lines[i].text
    const nextLine = lines[i + 1].text
    const nextConfidence = lines[i + 1].confidence

    // Extract 4-digit time values from the next line
    const timeValues = extractTimeValues(nextLine)
    if (timeValues.length === 0) continue

    // Check for OUT time: "DOOR CLS OUT" or just "OUT"
    if (currentLine.includes('OUT') && !result.outTime) {
      // OUT time is typically the second value after "DOOR CLS OUT"
      const outTime = timeValues.length >= 2 ? timeValues[1] : timeValues[0]
      result.outTime = formatTime(outTime)
      foundCount++
      totalConfidence += nextConfidence
    }

    // Check for ON and OFF times: "ON OFF"
    if (currentLine.includes('ON') && currentLine.includes('OFF')) {
      if (timeValues.length >= 2) {
        // First value is ON, second is OFF
        if (!result.onTime) {
          result.onTime = formatTime(timeValues[0])
          foundCount++
          totalConfidence += nextConfidence
        }
        if (!result.offTime) {
          result.offTime = formatTime(timeValues[1])
          foundCount++
          totalConfidence += nextConfidence
        }
      }
    }

    // Check for IN time: "IN TAXI" or just "IN"
    if (currentLine.includes('IN') && !currentLine.includes('PRINT') && !result.inTime) {
      // IN time is typically the first value after "IN TAXI"
      result.inTime = formatTime(timeValues[0])
      foundCount++
      totalConfidence += nextConfidence
    }
  }

  // Calculate overall confidence
  result.confidence = foundCount > 0 ? totalConfidence / foundCount : 0

  return result
}

/**
 * Extract 4-digit time values from a text line
 * Handles formats like "0336 0340", "03:36 03:40", "0336", etc.
 */
function extractTimeValues(text: string): string[] {
  const values: string[] = []

  // Match 4-digit numbers (HHMM format) or HH:MM format
  const matches = text.match(/\b(\d{4})\b|\b(\d{1,2}):(\d{2})\b/g)

  if (matches) {
    for (const match of matches) {
      if (match.includes(':')) {
        // HH:MM format - convert to HHMM
        const [h, m] = match.split(':')
        values.push(h.padStart(2, '0') + m)
      } else if (match.length === 4) {
        // HHMM format
        values.push(match)
      }
    }
  }

  return values
}

/**
 * Format a 4-digit time string (HHMM) to HH:MM
 */
function formatTime(time: string): string {
  if (!time || time.length !== 4) return ''

  const hours = time.substring(0, 2)
  const minutes = time.substring(2, 4)

  // Validate hours and minutes
  const h = parseInt(hours, 10)
  const m = parseInt(minutes, 10)

  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return ''
  }

  return `${hours}:${minutes}`
}
