import { describe, expect, it } from "vitest"
import { isChunkLoadError } from "@/lib/utils/chunk-recovery"

describe("isChunkLoadError", () => {
  it("recognises webpack's and the browsers' wording", () => {
    expect(isChunkLoadError({ name: "ChunkLoadError", message: "x" })).toBe(true)
    expect(isChunkLoadError(new Error("Loading chunk 8123 failed.\n(error: /_next/static/chunks/8123.js)"))).toBe(true)
    expect(isChunkLoadError(new Error("Loading CSS chunk app-layout failed"))).toBe(true)
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /x.js"))).toBe(true)
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true)
  })

  it("leaves every other error alone", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'localeCompare')"))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError("Loading chunk 1 failed")).toBe(false)
  })
})
