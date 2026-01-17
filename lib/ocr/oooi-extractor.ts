/**
 * OOOI Data Extractor
 *
 * Extracts flight data (OOOI times, flight numbers, aircraft, airports, etc.)
 * from OCR-extracted text. Uses pattern matching and heuristics to identify
 * relevant information from pilot logbooks and flight documents.
 */

export interface ExtractedFlightData {
  // Core OOOI times (HH:MM format)
  outTime?: string
  offTime?: string
  onTime?: string
  inTime?: string

  // Flight details
  flightNumber?: string
  date?: string // YYYY-MM-DD format
  aircraftReg?: string
  aircraftType?: string

  // Airports
  departureIcao?: string
  departureIata?: string
  arrivalIcao?: string
  arrivalIata?: string

  // Additional times
  scheduledOut?: string
  scheduledIn?: string
  blockTime?: string
  flightTime?: string

  // Confidence score (0-1)
  confidence: number

  // Raw text for debugging
  rawText?: string
}

/**
 * Extract flight data from OCR text
 */
export function extractFlightData(text: string): ExtractedFlightData {
  const result: ExtractedFlightData = {
    confidence: 0,
    rawText: text,
  }

  // Normalize text: convert to uppercase, remove extra whitespace
  const normalizedText = text.toUpperCase().replace(/\s+/g, ' ').trim()

  // Extract various fields
  result.date = extractDate(normalizedText)
  result.flightNumber = extractFlightNumber(normalizedText)
  result.aircraftReg = extractAircraftRegistration(normalizedText)
  result.aircraftType = extractAircraftType(normalizedText)

  // Extract airports
  const airports = extractAirports(normalizedText)
  if (airports.departure) {
    result.departureIcao = airports.departure.icao
    result.departureIata = airports.departure.iata
  }
  if (airports.arrival) {
    result.arrivalIcao = airports.arrival.icao
    result.arrivalIata = airports.arrival.iata
  }

  // Extract OOOI times
  const oooi = extractOOOITimes(normalizedText)
  result.outTime = oooi.out
  result.offTime = oooi.off
  result.onTime = oooi.on
  result.inTime = oooi.in

  // Extract scheduled times
  const scheduled = extractScheduledTimes(normalizedText)
  result.scheduledOut = scheduled.out
  result.scheduledIn = scheduled.in

  // Extract block and flight times
  result.blockTime = extractBlockTime(normalizedText)
  result.flightTime = extractFlightTime(normalizedText)

  // Calculate confidence score based on how many fields were extracted
  result.confidence = calculateConfidence(result)

  return result
}

/**
 * Extract date in various formats (DD/MM/YYYY, DD-MM-YYYY, DDMMMYY, etc.)
 */
function extractDate(text: string): string | undefined {
  // Try ISO format: YYYY-MM-DD
  const isoMatch = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/)
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  // Try DD MMM YY (e.g., 15 JAN 24)
  const dmmyMatch = text.match(/\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2})\b/)
  if (dmmyMatch) {
    const [, day, month, year] = dmmyMatch
    const monthMap: Record<string, string> = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
    }
    const fullYear = parseInt(year) < 50 ? `20${year}` : `19${year}`
    return `${fullYear}-${monthMap[month]}-${day.padStart(2, '0')}`
  }

  return undefined
}

/**
 * Extract flight number (e.g., TR123, SQ456, TR 123, SQ 456)
 */
function extractFlightNumber(text: string): string | undefined {
  // Pattern: 2-3 letter airline code + 3-4 digit number
  const match = text.match(/\b([A-Z]{2,3})\s*(\d{3,4})\b/)
  if (match) {
    return `${match[1]}${match[2]}`
  }
  return undefined
}

/**
 * Extract aircraft registration (e.g., 9V-ABC, N12345)
 */
function extractAircraftRegistration(text: string): string | undefined {
  // Pattern: Country code + hyphen + alphanumeric (e.g., 9V-TRB, N12345)
  const match = text.match(/\b([A-Z0-9]{1,2})-([A-Z]{3}|[A-Z0-9]{3,5})\b/)
  if (match) {
    return match[0]
  }
  return undefined
}

/**
 * Extract aircraft type (e.g., A320, B737, A388)
 */
function extractAircraftType(text: string): string | undefined {
  // Common aircraft type patterns
  const patterns = [
    /\b(A3[0-9]{2}|A35[0-9]|A38[0-9])\b/, // Airbus
    /\b(B7[0-9]{2}|B77[0-9]|B78[0-9]|B74[0-9])\b/, // Boeing
    /\b(E[1-2][0-9]{2})\b/, // Embraer
    /\b(CRJ[0-9]{3})\b/, // Bombardier
    /\b(ATR[0-9]{2})\b/, // ATR
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return match[0]
    }
  }

  return undefined
}

/**
 * Extract airports (ICAO and IATA codes)
 */
function extractAirports(text: string): {
  departure?: { icao?: string; iata?: string }
  arrival?: { icao?: string; iata?: string }
} {
  const result: {
    departure?: { icao?: string; iata?: string }
    arrival?: { icao?: string; iata?: string }
  } = {}

  // Look for patterns like "FROM XXX TO YYY" or "XXX - YYY"
  const routeMatch = text.match(/\b([A-Z]{3,4})\s*[-–—>TO]+\s*([A-Z]{3,4})\b/)
  if (routeMatch) {
    const [, from, to] = routeMatch
    result.departure = from.length === 4 ? { icao: from } : { iata: from }
    result.arrival = to.length === 4 ? { icao: to } : { iata: to }
    return result
  }

  // Look for labeled fields
  const fromMatch = text.match(/(?:FROM|DEP|DEPARTURE)[:\s]*([A-Z]{3,4})\b/)
  if (fromMatch) {
    const code = fromMatch[1]
    result.departure = code.length === 4 ? { icao: code } : { iata: code }
  }

  const toMatch = text.match(/(?:TO|ARR|ARRIVAL)[:\s]*([A-Z]{3,4})\b/)
  if (toMatch) {
    const code = toMatch[1]
    result.arrival = code.length === 4 ? { icao: code } : { iata: code }
  }

  return result
}

/**
 * Extract OOOI times (HH:MM format)
 */
function extractOOOITimes(text: string): {
  out?: string
  off?: string
  on?: string
  in?: string
} {
  const result: {
    out?: string
    off?: string
    on?: string
    in?: string
  } = {}

  // Look for labeled times
  const outMatch = text.match(/(?:OUT|PUSH)[:\s]*(\d{1,2})[:\s]*(\d{2})/)
  if (outMatch) {
    result.out = `${outMatch[1].padStart(2, '0')}:${outMatch[2]}`
  }

  const offMatch = text.match(/(?:OFF|T[\s/]O|TAKEOFF)[:\s]*(\d{1,2})[:\s]*(\d{2})/)
  if (offMatch) {
    result.off = `${offMatch[1].padStart(2, '0')}:${offMatch[2]}`
  }

  const onMatch = text.match(/(?:ON|LAND|TOUCHDOWN)[:\s]*(\d{1,2})[:\s]*(\d{2})/)
  if (onMatch) {
    result.on = `${onMatch[1].padStart(2, '0')}:${onMatch[2]}`
  }

  const inMatch = text.match(/(?:IN|BLOCK[\s]IN|ARRIVAL)[:\s]*(\d{1,2})[:\s]*(\d{2})/)
  if (inMatch) {
    result.in = `${inMatch[1].padStart(2, '0')}:${inMatch[2]}`
  }

  return result
}

/**
 * Extract scheduled times
 */
function extractScheduledTimes(text: string): {
  out?: string
  in?: string
} {
  const result: {
    out?: string
    in?: string
  } = {}

  const schedOutMatch = text.match(/(?:SCHED[\s]OUT|STD)[:\s]*(\d{1,2})[:\s]*(\d{2})/)
  if (schedOutMatch) {
    result.out = `${schedOutMatch[1].padStart(2, '0')}:${schedOutMatch[2]}`
  }

  const schedInMatch = text.match(/(?:SCHED[\s]IN|STA)[:\s]*(\d{1,2})[:\s]*(\d{2})/)
  if (schedInMatch) {
    result.in = `${schedInMatch[1].padStart(2, '0')}:${schedInMatch[2]}`
  }

  return result
}

/**
 * Extract block time (HH:MM format)
 */
function extractBlockTime(text: string): string | undefined {
  const match = text.match(/(?:BLOCK|BLK)[:\s]*(\d{1,2})[:\s](\d{2})/)
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}`
  }
  return undefined
}

/**
 * Extract flight time (HH:MM format)
 */
function extractFlightTime(text: string): string | undefined {
  const match = text.match(/(?:FLIGHT[\s]TIME|FLT)[:\s]*(\d{1,2})[:\s](\d{2})/)
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}`
  }
  return undefined
}

/**
 * Calculate confidence score based on extracted fields
 */
function calculateConfidence(data: ExtractedFlightData): number {
  let score = 0
  let maxScore = 0

  // OOOI times are critical (40 points total)
  maxScore += 40
  if (data.outTime) score += 10
  if (data.offTime) score += 10
  if (data.onTime) score += 10
  if (data.inTime) score += 10

  // Flight number (10 points)
  maxScore += 10
  if (data.flightNumber) score += 10

  // Date (10 points)
  maxScore += 10
  if (data.date) score += 10

  // Aircraft (10 points)
  maxScore += 10
  if (data.aircraftReg || data.aircraftType) score += 10

  // Airports (20 points)
  maxScore += 20
  if (data.departureIcao || data.departureIata) score += 10
  if (data.arrivalIcao || data.arrivalIata) score += 10

  // Scheduled times (10 points)
  maxScore += 10
  if (data.scheduledOut || data.scheduledIn) score += 10

  return Math.min(1, score / maxScore)
}

/**
 * Extract multiple flights from text (if the image contains multiple entries)
 */
export function extractMultipleFlights(text: string): ExtractedFlightData[] {
  // Split by common delimiters that might separate flight entries
  const sections = text.split(/\n{2,}|[-=]{3,}/)

  const flights: ExtractedFlightData[] = []

  for (const section of sections) {
    if (section.trim().length < 20) continue // Skip very short sections

    const flightData = extractFlightData(section)

    // Only include if we extracted something meaningful
    if (flightData.confidence > 0.2) {
      flights.push(flightData)
    }
  }

  return flights.length > 0 ? flights : [extractFlightData(text)]
}
