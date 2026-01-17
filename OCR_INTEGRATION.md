# OCR Integration Guide

This document describes the OCR (Optical Character Recognition) capabilities added to the OOOI Pilot Logbook PWA.

## Overview

The OCR integration allows pilots to extract flight data from images of flight logs, rosters, or other aviation documents by simply taking a photo or uploading an image. The system automatically recognizes and extracts:

- **OOOI Times** (Out, Off, On, In)
- **Flight Numbers** (e.g., TR123, SQ456)
- **Aircraft Registration** (e.g., 9V-TRB, N12345)
- **Aircraft Type** (e.g., A320, B737)
- **Airports** (ICAO and IATA codes)
- **Dates**
- **Scheduled Times**
- **Block and Flight Times**

## Architecture

### Components

```
/lib/ocr/
├── index.ts              # Public API exports
├── ocr-service.ts        # Core OCR engine (gutenye OCR wrapper)
└── oooi-extractor.ts     # Flight data extraction logic

/components/
└── image-import-button.tsx  # UI component for image capture/upload

/public/models/
├── ch_PP-OCRv4_det_infer.onnx    # Text detection model
├── ch_PP-OCRv4_rec_infer.onnx    # Text recognition model
└── ppocr_keys_v1.txt             # Character dictionary
```

### Technology Stack

- **OCR Engine**: gutenye/ocr-browser (PaddleOCR models)
- **Runtime**: ONNX Runtime via WebAssembly
- **Models**: PP-OCRv4 (Chinese models, but supports English)
- **Pattern Matching**: Regex-based extraction for aviation data

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

The `@gutenye/ocr-browser` package is already added to `package.json`.

### 2. Download OCR Model Files

The OCR models need to be placed in `/public/models/`. Choose one of these methods:

#### Option A: Manual Download (Recommended if network restricted)

1. Go to https://github.com/gutenye/ocr/tree/main/packages/models/assets
2. Download these three files:
   - `ch_PP-OCRv4_det_infer.onnx` (~3 MB)
   - `ch_PP-OCRv4_rec_infer.onnx` (~10 MB)
   - `ppocr_keys_v1.txt` (~6 KB)
3. Place them in `/public/models/`

#### Option B: Using Git LFS

```bash
# Clone the OCR repository
git clone https://github.com/gutenye/ocr.git /tmp/ocr-temp

# Copy model files
cp /tmp/ocr-temp/packages/models/assets/*.onnx ./public/models/
cp /tmp/ocr-temp/packages/models/assets/ppocr_keys_v1.txt ./public/models/

# Clean up
rm -rf /tmp/ocr-temp
```

#### Option C: From node_modules (if available after install)

```bash
# After npm install completes successfully
cp node_modules/@gutenye/ocr-models/assets/* ./public/models/ 2>/dev/null || echo "Models not in node_modules"
```

### 3. Verify Installation

Check that all model files are in place:

```bash
ls -lh public/models/
```

You should see:
```
ch_PP-OCRv4_det_infer.onnx
ch_PP-OCRv4_rec_infer.onnx
ppocr_keys_v1.txt
```

### 4. Build and Run

```bash
# Development
npm run dev

# Production build
npm run build
npm start
```

## Usage

### For Users

1. **From Logbook Page**:
   - Tap the camera icon in the header
   - Choose "Take Photo" or "Choose from Gallery"
   - Capture/select an image containing flight data
   - The app will process and extract the data
   - You'll be redirected to the flight form with pre-filled data

2. **From New Flight Form**:
   - Open the new flight form
   - Tap the camera icon next to the back button
   - Follow the same process as above
   - The form will auto-populate with extracted data
   - Review and adjust as needed before saving

### Expected Image Quality

For best results:
- **Good lighting** - avoid shadows and glare
- **Clear text** - focus on flight data sections
- **Straight orientation** - align the document properly
- **High contrast** - dark text on light background works best

### Supported Formats

The OCR system can extract data from:
- Printed logbooks
- Airline roster schedules
- Flight dispatch paperwork
- Crew briefing sheets
- Digital screenshots of flight data

## API Reference

### OCR Service (`/lib/ocr/ocr-service.ts`)

```typescript
import { extractTextFromImage, extractTextAsString, initializeOCR } from '@/lib/ocr'

// Extract text with bounding boxes and confidence scores
const lines = await extractTextFromImage(imageFile)
// Returns: { text: string, confidence: number, box: number[][] }[]

// Extract all text as a single string
const text = await extractTextAsString(imageFile)
// Returns: string

// Pre-initialize OCR (optional, for better UX)
await initializeOCR()
```

### OOOI Extractor (`/lib/ocr/oooi-extractor.ts`)

```typescript
import { extractFlightData, extractMultipleFlights } from '@/lib/ocr'

// Extract flight data from OCR text
const flightData = extractFlightData(ocrText)
// Returns: ExtractedFlightData with confidence score

// Extract multiple flights from a single image
const flights = extractMultipleFlights(ocrText)
// Returns: ExtractedFlightData[]
```

### Image Import Component

```tsx
import { ImageImportButton } from '@/components/image-import-button'

<ImageImportButton
  onDataExtracted={(data: ExtractedFlightData) => {
    // Handle extracted flight data
    console.log(data)
  }}
  variant="ghost"  // Optional: button variant
  size="icon"      // Optional: button size
/>
```

## Extraction Patterns

The OOOI extractor uses pattern matching to identify aviation data:

### Time Formats
```
OUT: 14:30, PUSH: 1430, Out 14:30
OFF: 14:45, T/O: 1445, Takeoff 14:45
ON: 16:15, LAND: 1615, Touchdown 16:15
IN: 16:30, BLOCK IN: 1630, Arrival 16:30
```

### Flight Numbers
```
TR123, SQ 456, TR 789, BA 2345
```

### Aircraft Registrations
```
9V-TRB, N12345, G-ABCD, VH-OQA
```

### Aircraft Types
```
A320, A321, A350, B737, B777, B787
E190, CRJ900, ATR72
```

### Airports
```
WSSS (Singapore), SIN
VHHH (Hong Kong), HKG
WSSS - VHHH, SIN to HKG
FROM WSSS TO VHHH
```

### Dates
```
2024-01-15, 15/01/2024, 15-01-2024
15 JAN 24, 15 JAN 2024
```

## Performance

- **Initial Load**: ~2-3 seconds (one-time model loading)
- **Image Processing**: ~1-5 seconds depending on image size and complexity
- **Model Size**: ~13 MB total (cached after first load)
- **Offline Support**: Yes, works fully offline after models are loaded

## Troubleshooting

### OCR Not Working

1. **Check model files**:
   ```bash
   ls -lh public/models/
   ```
   Ensure all three files are present and not empty.

2. **Check browser console** for errors:
   - Open DevTools (F12)
   - Look for OCR initialization errors
   - Check for CORS or loading issues

3. **Try a different image**:
   - Use high-quality, well-lit photos
   - Ensure text is clearly visible
   - Try a simpler layout first

### Low Confidence Scores

If the confidence score is low (< 50%):
- Improve image quality
- Ensure better lighting
- Focus on the relevant text area
- Try re-taking the photo

### Missing Fields

If certain fields aren't extracted:
- Check that the text follows expected patterns
- Verify field labels are visible (OUT, OFF, ON, IN)
- Ensure proper spacing and formatting

### Performance Issues

If OCR is slow:
- Reduce image size before upload
- Close other browser tabs
- Clear browser cache
- Check device resources

## Customization

### Adding New Patterns

To add support for new flight data formats, edit `/lib/ocr/oooi-extractor.ts`:

```typescript
// Example: Add support for new airline code format
function extractFlightNumber(text: string): string | undefined {
  // Add your pattern here
  const match = text.match(/\b([A-Z]{2,3})\s*(\d{3,4})\b/)
  if (match) {
    return `${match[1]}${match[2]}`
  }
  return undefined
}
```

### Adjusting Confidence Thresholds

In `oooi-extractor.ts`, modify the `calculateConfidence` function:

```typescript
function calculateConfidence(data: ExtractedFlightData): number {
  // Adjust scoring weights
  if (data.outTime) score += 10  // Increase from 10 to 15 for higher weight
  // ...
}
```

## Future Enhancements

Potential improvements for the OCR system:

1. **Multi-language Support**: Add support for other language models
2. **Batch Processing**: Extract multiple flights from roster schedules
3. **Image Preprocessing**: Auto-rotate, crop, and enhance images
4. **Field Validation**: Cross-check extracted data with airport/aircraft databases
5. **Learning**: Improve patterns based on user corrections
6. **Cloud OCR**: Fallback to cloud-based OCR for complex cases

## Security & Privacy

- **All processing is local** - images never leave the device
- **No data collection** - OCR runs entirely in the browser
- **Offline capable** - works without internet connection
- **Model caching** - models cached in browser for performance

## Credits

- **OCR Engine**: [gutenye/ocr](https://github.com/gutenye/ocr)
- **Models**: PaddleOCR PP-OCRv4
- **Runtime**: ONNX Runtime Web

## Support

For issues or questions:
1. Check this documentation
2. Review the troubleshooting section
3. Check browser console for errors
4. Open an issue on GitHub with:
   - Browser and version
   - Error messages
   - Sample image (if not sensitive)
   - Steps to reproduce
