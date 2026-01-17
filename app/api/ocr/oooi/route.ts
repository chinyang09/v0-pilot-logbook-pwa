/**
 * OOOI OCR API Route
 *
 * POST: Extract OOOI times and flight data from an uploaded image
 * GET: Health check / status endpoint
 */

import { NextRequest, NextResponse } from 'next/server'
import { extractTextFromBuffer, isOCRReady, warmupOCR } from '@/lib/ocr/ocr-service-server'
import { extractFlightData, type ExtractedFlightData } from '@/lib/ocr/oooi-extractor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Response type for the OCR API
interface OcrApiResponse {
  success: boolean
  data?: ExtractedFlightData
  error?: string
  metadata?: {
    processingTimeMs: number
    totalLinesDetected: number
    rawText?: string
  }
}

/**
 * POST /api/ocr/oooi
 * Extract OOOI times and flight data from an uploaded image
 */
export async function POST(request: NextRequest): Promise<NextResponse<OcrApiResponse>> {
  const startTime = Date.now()

  try {
    // Get the form data
    const formData = await request.formData()
    const file = formData.get('image') as File | null

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No image file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { success: false, error: 'Invalid file type. Please upload an image.' },
        { status: 400 }
      )
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: 'File too large. Maximum size is 10MB.' },
        { status: 400 }
      )
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Extract text from image using OCR
    console.log('[OCR API] Processing image:', file.name, 'Size:', file.size)
    const textLines = await extractTextFromBuffer(buffer)

    // Combine all detected text
    const fullText = textLines.map(line => line.text).join('\n')
    console.log('[OCR API] Extracted text lines:', textLines.length)

    // Parse flight data from the extracted text
    const flightData = extractFlightData(fullText)

    const processingTimeMs = Date.now() - startTime
    console.log('[OCR API] Processing complete in', processingTimeMs, 'ms')

    return NextResponse.json({
      success: true,
      data: flightData,
      metadata: {
        processingTimeMs,
        totalLinesDetected: textLines.length,
        rawText: fullText,
      },
    })
  } catch (error) {
    console.error('[OCR API] Error processing image:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          totalLinesDetected: 0,
        },
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/ocr/oooi
 * Health check endpoint - also pre-warms the OCR engine
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Pre-warm the OCR engine if not already initialized
    if (!isOCRReady()) {
      await warmupOCR()
    }

    return NextResponse.json({
      status: 'ready',
      message: 'OOOI OCR service is initialized and ready',
      ocrReady: isOCRReady(),
    })
  } catch (error) {
    console.error('[OCR API] Health check failed:', error)

    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to initialize OCR',
        ocrReady: false,
      },
      { status: 503 }
    )
  }
}
