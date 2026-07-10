// Lightweight User-Agent parser shared by the account "Active Sessions" UI.
// Produces a human-friendly device label like "Chrome on Windows" or
// "Safari on iPhone" from a raw UA string. Deliberately dependency-free and
// best-effort — UA strings are unreliable, so an unknown value degrades to a
// sensible generic label rather than throwing.

export interface ParsedUserAgent {
  /** Combined label, e.g. "Chrome on Windows" or "Safari on iPad". */
  deviceName: string
  browser: string
  os: string
}

function detectBrowser(ua: string): string {
  // Order matters: many browsers spoof "Safari"/"Chrome" in their UA, so the
  // more specific brands are tested first.
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return "Edge"
  if (/\bOPR\/|\bOpera\b/.test(ua)) return "Opera"
  if (/\bSamsungBrowser\//.test(ua)) return "Samsung Internet"
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return "Firefox"
  // Chrome on iOS reports as CriOS.
  if (/\bCriOS\//.test(ua)) return "Chrome"
  if (/\bChrome\/|\bChromium\//.test(ua)) return "Chrome"
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "Safari"
  if (/\bSafari\//.test(ua)) return "Safari"
  return "Browser"
}

function detectOS(ua: string): string {
  if (/\biPhone\b/.test(ua)) return "iPhone"
  if (/\biPad\b/.test(ua)) return "iPad"
  // iPadOS 13+ masquerades as desktop Safari on "Macintosh"; the touch hint
  // isn't in the UA, so we can't always disambiguate — treat as Mac.
  if (/\bAndroid\b/.test(ua)) return "Android"
  if (/\bWindows NT\b/.test(ua)) return "Windows"
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return "Mac"
  if (/\bCrOS\b/.test(ua)) return "ChromeOS"
  if (/\bLinux\b/.test(ua)) return "Linux"
  return "Unknown device"
}

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua || typeof ua !== "string") {
    return { deviceName: "Unknown device", browser: "Browser", os: "Unknown device" }
  }

  const browser = detectBrowser(ua)
  const os = detectOS(ua)

  // For the iPhone/iPad case the OS already names the device, so "Safari on
  // iPhone" reads naturally. For desktop OSes it's "<Browser> on <OS>".
  const deviceName = os === "Unknown device" ? browser : `${browser} on ${os}`

  return { deviceName, browser, os }
}
