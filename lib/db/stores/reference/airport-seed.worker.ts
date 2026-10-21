/**
 * Seeds the airports table off the main thread — see `seedFromSource` in
 * airports.store.ts for why. `{ type: "seed" }` fetches the bundled dataset,
 * parses it and writes it; the worker answers with progress, then `done` or
 * `error`.
 */

import { AIRPORT_SOURCE_URL, writeAirportRows, type AirportSeedMessage } from "./airport-seed"

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ type: "seed" }>) => void) | null
  postMessage: (message: AirportSeedMessage) => void
}

scope.onmessage = async () => {
  try {
    const response = await fetch(AIRPORT_SOURCE_URL)
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)
    const rows = await writeAirportRows(await response.json(), (done) => scope.postMessage({ type: "progress", done }))
    scope.postMessage({ type: "done", count: rows.length })
  } catch (error) {
    scope.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) })
  }
}
