/**
 * OCR Module - Export all OCR-related functionality
 */

export {
  initializeOCR,
  extractTextFromImage,
  extractTextAsString,
  preloadOCR,
  isOCRReady,
  resetOCR,
} from './ocr-service'

export {
  extractFlightData,
  extractMultipleFlights,
  type ExtractedFlightData,
} from './oooi-extractor'
