import * as h from "./harness.mjs"
import * as f from "./flows.mjs"

const results = []
const log = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`) }

await h.resetDb(); await h.launch()
const A = await h.device("A")
const B = await h.device("B")

// S1 — create on A reaches B, with nothing pending on B (the old "only at login" bug)
const id = await f.createFlight(A)
await f.setFlightNumber(A, "TR101")
let t = await f.until(async () => (await f.getLocal(B, "flights", id))?.flightNumber === "TR101", 70000)
log("S1 A's new flight reaches idle B (poll)", t >= 0, `${t}ms`)

// S2 — B edits; A (which also has the form open) gets it
await f.openFlight(B, id)
await f.tapNow(B, "Out")
const bOut = async () => (await f.getLocal(B, "flights", id))?.outTime
await f.until(async () => !!(await bOut()), 10000)
const outB = await bOut()
t = await f.until(async () => (await f.getLocal(A, "flights", id))?.outTime === outB, 70000)
log("S2 B's OUT time reaches A", t >= 0, `${t}ms (out=${outB})`)

// S3 — STALE device: B goes offline, A changes the flight number, B (still
// holding the old copy) sets OFF and comes back. Both edits must survive.
await B.context.setOffline(true)
await f.setFlightNumber(A, "TR202")
await f.until(async () => (await h.db().collection("flights").findOne({ id }))?.flightNumber === "TR202", 30000)
await f.tapNow(B, "Off")
await h.sleep(1500)
const bLocalOffline = await f.getLocal(B, "flights", id)
await B.context.setOffline(false)
B.page.evaluate(() => window.dispatchEvent(new Event("online")))
t = await f.until(async () => { const d = await h.db().collection("flights").findOne({ id }); return d?.offTime === bLocalOffline.offTime }, 30000)
const srv = await h.db().collection("flights").findOne({ id })
log("S3 stale B's OFF edit lands on the server", t >= 0, `${t}ms after reconnect`)
log("S3 …without reverting A's flight number", srv.flightNumber === "TR202", `server flightNumber=${srv.flightNumber} (B's stale copy had ${bLocalOffline.flightNumber})`)
t = await f.until(async () => { const r = await f.getLocal(B, "flights", id); return r.flightNumber === "TR202" && r.offTime === bLocalOffline.offTime }, 70000)
log("S3 …and B converges to both edits", t >= 0, `${t}ms`)
t = await f.until(async () => (await f.getLocal(A, "flights", id))?.offTime === bLocalOffline.offTime, 70000)
log("S3 …and A gets B's OFF", t >= 0, `${t}ms`)

// S4 — the SAME field on both while one is offline: later edit wins, loser kept
await A.context.setOffline(true)
await f.setFlightNumber(A, "TR-A-OFFLINE")
await h.sleep(1500)
await f.setFlightNumber(B, "TR-B-LATER")
await f.until(async () => (await h.db().collection("flights").findOne({ id }))?.flightNumber === "TR-B-LATER", 30000)
await A.context.setOffline(false)
A.page.evaluate(() => window.dispatchEvent(new Event("online")))
await f.until(async () => (await h.db().collection("syncConflicts").countDocuments({ recordId: id })) > 0, 30000)
const conflict = await h.db().collection("syncConflicts").findOne({ recordId: id })
const srv4 = await h.db().collection("flights").findOne({ id })
log("S4 same-field conflict: later edit kept on server", srv4.flightNumber === "TR-B-LATER", `server=${srv4.flightNumber}`)
log("S4 …losing value recorded", conflict?.discarded === "TR-A-OFFLINE", `conflict=${JSON.stringify(conflict && { field: conflict.field, kept: conflict.kept, discarded: conflict.discarded })}`)
t = await f.until(async () => (await f.getLocal(A, "flights", id))?.flightNumber === "TR-B-LATER", 30000)
log("S4 …A converges to the winner", t >= 0, `${t}ms`)

// S5 — offline edit is pushed promptly on reconnect
await B.context.setOffline(true)
await f.tapNow(B, "On")
await h.sleep(1000)
const before = Date.now()
await B.context.setOffline(false)
B.page.evaluate(() => window.dispatchEvent(new Event("online")))
const onB = (await f.getLocal(B, "flights", id)).onTime
t = await f.until(async () => (await h.db().collection("flights").findOne({ id }))?.onTime === onB, 30000, 200)
log("S5 offline edit pushed on reconnect", t >= 0 && t < 5000, `${t}ms`)

// S6 — fresh device C gets everything on first open
const C = await h.device("C")
t = await f.until(async () => (await f.getLocal(C, "flights", id))?.onTime === onB, 30000)
log("S6 new device C has the flight on first sync", t >= 0, `${t}ms`)

// S7 — uniform documents
const docs = await h.db().collection("flights").find({}).toArray()
const shapes = new Set(docs.map((d) => Object.keys(d).join(",")))
log("S7 every flight document has the same keys", shapes.size === 1, `${docs.length} docs, ${shapes.size} shape(s), ${Object.keys(docs[0]).length} keys`)

// S8 — second tab on device A sees an edit made in the first tab without reload
const tab2 = await A.context.newPage()
await tab2.goto(`${h.BASE}/logbook`)
await h.sleep(3000)
await f.setFlightNumber(A, "TR808")
t = await f.until(async () => (await tab2.locator("text=TR808").count()) > 0, 20000)
log("S8 second tab shows tab 1's edit without reload", t >= 0, `${t}ms`)

// Request audit
const summarize = (d) => {
  const sync = d.requests.filter((r) => r.url === "/api/sync")
  return `${d.name}: ${sync.length} round trips, ${d.requests.length - sync.length} other sync requests`
}
console.log("\n" + [A, B, C].map(summarize).join("\n"))
const errs = [A, B, C].flatMap((d) => d.logs.filter((l) => /PAGEERROR|\[Sync[^\]]*\].*(fail|error)/i.test(l)))
console.log("errors:", errs.length ? "\n" + errs.slice(0, 15).join("\n") : "none")
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`)
await h.close()
