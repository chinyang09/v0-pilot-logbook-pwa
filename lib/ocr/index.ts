/**
 * OCR Module
 */

export {
  initializeOCR,
  extractTextFromImage,
  extractTextAsString,
  preloadOCR,
  isOCRReady,
  resetOCR,
} from "./ocr-service"

export {
  extractFlightData,
  validateExtractedData,
  type OcrResult,
  type ExtractedFlightData,
} from "./oooi-extractor"
