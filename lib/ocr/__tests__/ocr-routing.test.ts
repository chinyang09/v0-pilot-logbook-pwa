/**
 * Which engine reads a photo. The device goes first; the server is asked only
 * when the device fails, or is still working after `HEDGE_MS`, and the first
 * answer wins. The 10-second reads on a phone were the server path — upload,
 * a cold function on another continent, the download — so the order is the
 * whole point.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const device = vi.hoisted(() => ({ read: vi.fn(), prime: vi.fn() }))
vi.mock("../engine/device", () => ({
  readOnDevice: device.read,
  primeDeviceEngine: device.prime,
  warmDeviceEngineCode: () => {},
}))
vi.mock("@/lib/utils/image-compress", () => ({ compressImage: async (f: File) => f }))

const line = (text: string) => ({ text, confidence: 1, box: [[0, 0], [1, 0], [1, 1], [0, 1]] })
const photo = new File([new Uint8Array([1])], "mcdu.jpg", { type: "image/jpeg" })

let fetchMock: ReturnType<typeof vi.fn>

async function service() {
  vi.resetModules()
  return import("../ocr-service")
}

function serverAnswers(text: string) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: true, results: [line(text)] }), { status: 200 }))
}

beforeEach(() => {
  device.read.mockReset()
  device.prime.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("navigator", { onLine: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("OCR routing", () => {
  it("reads on the device and never touches the server when the device answers", async () => {
    device.read.mockResolvedValue([line("DEVICE")])
    const { extractTextFromImage } = await service()
    expect((await extractTextFromImage(photo)).map((l) => l.text)).toEqual(["DEVICE"])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("falls back to the server when the device engine fails, and goes server-first after", async () => {
    device.read.mockRejectedValue(new Error("no SIMD"))
    serverAnswers("SERVER")
    const { extractTextFromImage } = await service()
    expect((await extractTextFromImage(photo)).map((l) => l.text)).toEqual(["SERVER"])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    device.read.mockClear()
    await extractTextFromImage(photo)
    expect(device.read).not.toHaveBeenCalled()
  })

  it("asks the server as well once the device has been working too long; the first answer wins", async () => {
    vi.useFakeTimers()
    device.read.mockReturnValue(new Promise(() => {}))
    serverAnswers("SERVER")
    const { extractTextFromImage } = await service()
    const read = extractTextFromImage(photo)
    await vi.advanceTimersByTimeAsync(3_999)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await read).map((l) => l.text)).toEqual(["SERVER"])
  })

  it("offline, a device failure is the answer — there is nothing to fall back to", async () => {
    vi.stubGlobal("navigator", { onLine: false })
    device.read.mockRejectedValue(new Error("out of memory"))
    const { extractTextFromImage } = await service()
    await expect(extractTextFromImage(photo)).rejects.toThrow("out of memory")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
