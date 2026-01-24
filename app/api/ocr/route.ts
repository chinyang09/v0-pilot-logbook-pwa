/**
 * OCR API Endpoint - Server-side OCR using gutenye/ocr-node
 *
 * This endpoint processes images using the Node.js OCR library,
 * providing faster and more reliable results than browser-based OCR.
 */

import { NextRequest, NextResponse } from "next/server"
import { writeFile, unlink, mkdir } from "fs/promises"
import { join } from "path"
import { randomUUID } from "crypto"
import { tmpdir } from "os"

interface OcrLine {
  text: string
  mean: number
  box?: number[][]
}

// Lazy-loaded OCR instance (singleton)
let ocrInstance: { detect: (image: string) => Promise<OcrLine[]> } | null = null
let ocrInitPromise: Promise<typeof ocrInstance> | null = null

async function getOcrInstance() {
  if (ocrInstance) return ocrInstance

  if (ocrInitPromise) return ocrInitPromise

  ocrInitPromise = (async () => {
    try {
      // Dynamic import to avoid loading at build time
      const { default: Ocr } = await import("@gutenye/ocr-node")
      ocrInstance = await Ocr.create()
      return ocrInstance
    } catch (error) {
      console.error("Failed to initialize OCR:", error)
      ocrInitPromise = null
      throw error
    }
  })()

  return ocrInitPromise
}

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null

  try {
    const contentType = request.headers.get("content-type") || ""

    let imageBuffer: Buffer

    if (contentType.includes("multipart/form-data")) {
      // Handle FormData upload
      const formData = await request.formData()
      const file = formData.get("image") as File | null

      if (!file) {
        return NextResponse.json(
          { error: "No image file provided" },
          { status: 400 }
        )
      }

      const arrayBuffer = await file.arrayBuffer()
      imageBuffer = Buffer.from(arrayBuffer)
    } else if (contentType.includes("application/json")) {
      // Handle base64 JSON upload
      const body = await request.json()

      if (!body.image) {
        return NextResponse.json(
          { error: "No image data provided" },
          { status: 400 }
        )
      }

      // Remove data URL prefix if present
      const base64Data = body.image.replace(/^data:image\/\w+;base64,/, "")
      imageBuffer = Buffer.from(base64Data, "base64")
    } else {
      return NextResponse.json(
        { error: "Unsupported content type. Use multipart/form-data or application/json" },
        { status: 400 }
      )
    }

    // Validate image size (max 10MB)
    if (imageBuffer.length > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image too large. Maximum size is 10MB" },
        { status: 400 }
      )
    }

    // Write image to temp file (ocr-node requires file path)
    const tempDir = join(tmpdir(), "ocr-uploads")
    await mkdir(tempDir, { recursive: true })
    tempFilePath = join(tempDir, `${randomUUID()}.jpg`)
    await writeFile(tempFilePath, imageBuffer)

    // Get OCR instance and process image
    const ocr = await getOcrInstance()
    if (!ocr) {
      return NextResponse.json(
        { error: "OCR engine not available" },
        { status: 503 }
      )
    }

    const results = await ocr.detect(tempFilePath)

    // Transform results to match expected format
    const transformedResults = results
      .map((item) => ({
        text: item.text.trim(),
        confidence: item.mean,
        box: item.box || [[0, 0], [0, 0], [0, 0], [0, 0]],
      }))
      .filter((item) => item.text.length > 0)
      .sort((a, b) => {
        // Sort by Y then X
        const ay = (a.box[0][1] + a.box[2][1]) / 2
        const by = (b.box[0][1] + b.box[2][1]) / 2
        if (Math.abs(ay - by) > 10) return ay - by
        return a.box[0][0] - b.box[0][0]
      })

    return NextResponse.json({
      success: true,
      results: transformedResults,
    })
  } catch (error) {
    console.error("OCR API error:", error)

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred"

    return NextResponse.json(
      { error: `OCR processing failed: ${errorMessage}` },
      { status: 500 }
    )
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath)
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// Health check endpoint
export async function GET() {
  try {
    const ocr = await getOcrInstance()
    return NextResponse.json({
      status: "ready",
      engine: "ocr-node",
      available: !!ocr,
    })
  } catch {
    return NextResponse.json({
      status: "unavailable",
      engine: "ocr-node",
      available: false,
    })
  }
}
