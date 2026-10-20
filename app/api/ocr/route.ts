/**
 * OCR API Endpoint — the shared pipeline (`lib/ocr/engine/core`) on
 * onnxruntime-node, which uses every core the function has.
 */

import { NextRequest, NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { primeServerModels, readImageOnServer } from "@/lib/ocr/engine/node"

// Bound execution (also gives the cold ONNX model load enough headroom vs the
// short serverless default).
export const maxDuration = 60

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10MB

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

    // The decode caps the size at OCR_MAX_SIDE HERE as well as on the
    // client: detection runs at whatever resolution it is handed, and an
    // older client build still uploads at 2048. It also applies the EXIF
    // orientation, which the raw pixels do not carry.
    const { lines, stats } = await readImageOnServer(imageBuffer)

    return NextResponse.json({ success: true, results: lines, stats })
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

// Health check — also how the client WARMS the function: loading the models
// here means the photo that follows does not pay for it.
export async function GET() {
  try {
    await primeServerModels()
    return NextResponse.json({ status: "ready", engine: "ppocr-v4", available: true })
  } catch (error) {
    console.error("OCR engine unavailable:", error)
    return NextResponse.json({ status: "unavailable", engine: "ppocr-v4", available: false })
  }
}
