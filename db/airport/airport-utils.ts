/**
 * Airport utility functions
 */

export function getAirportLocalTime(tz: string): string {
  try {
    const now = new Date()
    const offsetStr =
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "shortOffset",
      })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value || "UTC"

    const timeStr = now.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    })

    return `${timeStr} (${offsetStr})`
  } catch {
    return "Time Unavailable"
  }
}

export function getAirportTimeInfo(tz: string): { offset: number; offsetStr: string } {
  try {
    const now = new Date()
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(now)

    const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value || ""
    const match = offsetPart.match(/([+-]\d+)/)
    const offset = match ? Number.parseInt(match[1]) : 0

    const shortParts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(now)
    const offsetStr = shortParts.find((p) => p.type === "timeZoneName")?.value || "UTC"

    return { offset, offsetStr }
  } catch {
    return { offset: 0, offsetStr: "UTC" }
  }
}
