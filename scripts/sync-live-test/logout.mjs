import * as h from "./harness.mjs"
import * as f from "./flows.mjs"
await h.resetDb(); await h.launch()
const B = await h.device("B")
const id = await f.createFlight(B)
await h.sleep(4000)
await B.page.goto(`${h.BASE}/account`)
await h.sleep(4000)
// The server becomes unreachable for sync (a dead network, a cold start that fails)…
await B.context.route("**/api/sync", (r) => r.abort())
// …and an edit is made that therefore cannot be pushed.
await f.openFlight(B, id)
await f.setFlightNumber(B, "UNSYNCED1")
await h.sleep(2500)
console.log("queue before:", (await h.local(B, "syncQueue")).length)
await B.page.goto(`${h.BASE}/account`)
await h.sleep(4000)
let dialogMsg = null
B.page.on("dialog", async (d) => { dialogMsg = d.message(); await d.dismiss() })
const btn = B.page.locator("button", { hasText: /log out of all devices/i }).first()
console.log("button found:", await btn.count())
await btn.click()
await h.sleep(14000)
console.log("dialog:", dialogMsg)
console.log("url:", B.page.url())
const kept = (await f.getLocal(B, "flights", id))?.flightNumber
const ok = !!dialogMsg && kept === "UNSYNCED1" && (await h.local(B, "syncQueue")).length === 1
console.log(`${ok ? "PASS" : "FAIL"}  sign-out with an unsynced edit asks first, and cancelling keeps the edit (kept=${kept})`)
await h.close()
