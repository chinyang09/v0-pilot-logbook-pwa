/**
 * OCR API Endpoint - Server-side OCR using gutenye/ocr-node
 *
 * This endpoint processes images using the Node.js OCR library,
 * providing faster and more reliable results than browser-based OCR.
 */

import { NextRequest, NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { OCR_MAX_SIDE } from "@/lib/ocr/limits"

// Bound execution (also gives the cold ONNX model load enough headroom vs the
// short serverless default).
export const maxDuration = 60

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10MB

interface OcrLine {
  text: string
  mean: number
  box?: number[][]
}

// Lazy-loaded OCR instance (singleton)
// ocr-node hands its input straight to `sharp()`, which takes a Buffer as
// readily as a path — so the image never touches the disk.
type OcrInstance = { detect: (image: string | Buffer) => Promise<OcrLine[]> }
let ocrInstance: OcrInstance | null = null
let ocrInitPromise: Promise<OcrInstance | null> | null = null

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
  // OCR runs a CPU/memory-heavy ONNX model server-side. Require a valid session
  // (cookie-based — the client posts FormData from the browser) so it can't be
  // used as an unauthenticated compute/DoS vector.
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Reject oversized uploads up front, before buffering/parsing the body.
  const contentLength = Number(request.headers.get("content-length") || "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES * 1.4) {
    return NextResponse.json(
      { error: "Image too large. Maximum size is 10MB" },
      { status: 413 }
    )
  }

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

    // Validate decoded image size (max 10MB)
    if (imageBuffer.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image too large. Maximum size is 10MB" },
        { status: 400 }
      )
    }

    // Cap the size HERE as well as on the client: detection runs at whatever
    // resolution it is handed (the library has no ceiling), and a phone photo
    // is 12MP. Measured on real MCDU photos: 19.4s at 3072x4080, ~1s at 1024,
    // with identical times extracted. An older client build still uploads at
    // 2048, so the server cannot rely on the client having done it. `rotate()`
    // applies the EXIF orientation, which the raw pixels do not carry.
    const { default: sharp } = await import("sharp")
    const prepared = await sharp(imageBuffer)
      .rotate()
      .resize({ width: OCR_MAX_SIDE, height: OCR_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()

    // Get OCR instance and process image
    const ocr = await getOcrInstance()
    if (!ocr) {
      return NextResponse.json(
        { error: "OCR engine not available" },
        { status: 503 }
      )
    }

    const results = await ocr.detect(prepared)

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
