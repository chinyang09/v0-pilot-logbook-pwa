/**
 * OCR Module - Export all OCR-related functionality
 */

export {
  initializeOCR,
  extractTextFromImage,
  preloadOCR,
  isOCRReady,
  resetOCR,
  type OcrTextResult,
} from './ocr-service'

export {
  extractOOOITimes,
  type OOOITimes,
} from './oooi-extractor'
