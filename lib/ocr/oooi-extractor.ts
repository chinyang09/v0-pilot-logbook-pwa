/**
 * OOOI Time Extractor - Parses OUT, OFF, ON, IN times from OCR results
 */

import type { OcrTextResult } from './ocr-service'

export interface OOOITimes {
  outTime?: string
  offTime?: string
  onTime?: string
  inTime?: string
  confidence: number
}

/**
 * Extract OOOI times from OCR results
 *
 * AOC VOYAGE format:
 * - "DOOR CLS OUT" → "0336 0340" (door close, out time)
 * - "ON OFF" → "0626 0354" (on time, off time)
 * - "IN TAXI" → "0630 0345" (in time, taxi time)
 */
export function extractOOOITimes(ocrResults: OcrTextResult[]): OOOITimes {
  const result: OOOITimes = { confidence: 0 }

  if (!ocrResults?.length) return result

  // Sort by Y position (reading order)
  const sorted = [...ocrResults].sort((a, b) => {
    const aY = a.box?.[0]?.[1] ?? 0
    const bY = b.box?.[0]?.[1] ?? 0
    return aY - bY
  })

  const lines = sorted.map(r => ({
    text: (r.text || '').toUpperCase().trim(),
    conf: r.mean || 0,
  }))

  let found = 0
  let confSum = 0

  // Process label-value pairs
  for (let i = 0; i < lines.length - 1; i++) {
    const label = lines[i].text
    const values = extractTimes(lines[i + 1].text)
    const conf = lines[i + 1].conf

    if (!values.length) continue

    // OUT: from "DOOR CLS OUT" line
    if (label.includes('OUT') && !result.outTime) {
      result.outTime = formatTime(values[1] || values[0])
      if (result.outTime) { found++; confSum += conf }
    }

    // ON and OFF: from "ON OFF" line
    if (label.includes('ON') && label.includes('OFF') && values.length >= 2) {
      if (!result.onTime) {
        result.onTime = formatTime(values[0])
        if (result.onTime) { found++; confSum += conf }
      }
      if (!result.offTime) {
        result.offTime = formatTime(values[1])
        if (result.offTime) { found++; confSum += conf }
      }
    }

    // IN: from "IN TAXI" line
    if (label.includes('IN') && !label.includes('PRINT') && !result.inTime) {
      result.inTime = formatTime(values[0])
      if (result.inTime) { found++; confSum += conf }
    }
  }

  result.confidence = found > 0 ? confSum / found : 0
  return result
}

/**
 * Extract 4-digit time values from text
 */
function extractTimes(text: string): string[] {
  const times: string[] = []
  const matches = text.match(/\b\d{4}\b|\b\d{1,2}:\d{2}\b/g) || []

  for (const m of matches) {
    if (m.includes(':')) {
      const [h, min] = m.split(':')
      times.push(h.padStart(2, '0') + min)
    } else {
      times.push(m)
    }
  }
  return times
}

/**
 * Format HHMM to HH:MM with validation
 */
function formatTime(time: string): string {
  if (!time || time.length !== 4) return ''

  const h = parseInt(time.slice(0, 2), 10)
  const m = parseInt(time.slice(2, 4), 10)

  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return ''

  return `${time.slice(0, 2)}:${time.slice(2, 4)}`
}
