/**
 * Live multi-device harness: each "device" is its own browser profile (its own
 * cookies and IndexedDB) signed in as the same pilot, driving the real app
 * against a real MongoDB. See README.md.
 */
import { chromium } from "playwright-core"
import { MongoClient } from "mongodb"
import crypto from "node:crypto"

export const BASE = process.env.BASE || "http://localhost:3100"
export const USER = { userId: "live-user-1", callsign: "LIVETEST" }
export const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/?replicaSet=rs0"
export const mongo = new MongoClient(MONGO_URI)
export const db = () => mongo.db("skylog")

/** Wipes the `skylog` database — point MONGODB_URI at a throwaway server. */
export async function resetDb() {
  await mongo.connect()
  if (!/127\.0\.0\.1|localhost/.test(MONGO_URI) && !process.env.I_KNOW_THIS_WIPES_THE_DATABASE) {
    throw new Error("refusing to drop a non-local database; set I_KNOW_THIS_WIPES_THE_DATABASE=1")
  }
  await db().dropDatabase()
  await db().collection("users").insertOne({ _id: USER.userId, id: USER.userId, identity: { callsign: USER.callsign, searchKey: USER.callsign.toLowerCase() }, auth: { passkeys: [] }, createdAt: new Date() })
}

export async function newSessionToken(deviceId) {
  const token = crypto.randomBytes(24).toString("hex")
  const now = new Date()
  // The row holds the hash, as `issueSession` writes it; the cookie carries the raw value.
  await db().collection("sessions").insertOne({ token: crypto.createHash("sha256").update(token).digest("hex"), userId: USER.userId, callsign: USER.callsign, deviceId, expiresAt: new Date(Date.now() + 30 * 864e5), lastAccessedAt: now, updatedAt: now, createdAt: now })
  return token
}

let browser
export async function launch() {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] })
  return browser
}

/** One "device": its own browser profile (cookies + IndexedDB), logged in. */
export async function device(name, { width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" })
  const token = await newSessionToken(`dev-${name}`)
  await context.addCookies([{ name: "session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }])
  const page = await context.newPage()
  const logs = []
  page.on("console", (m) => { const t = m.text(); if (!/SW\]|Hydration|Download the React/.test(t)) logs.push(`${name}: ${t}`) })
  page.on("pageerror", (e) => logs.push(`${name} PAGEERROR: ${e.message}`))
  const requests = []
  page.on("request", (r) => { if (r.url().includes("/api/sync")) requests.push({ t: Date.now(), url: r.url().replace(BASE, ""), method: r.method(), body: r.postData() }) })
  await page.goto(`${BASE}/login`)
  await page.waitForTimeout(1500)
  // Seed the IndexedDB session mirror the login flow would have written.
  await page.evaluate(async (u) => {
    await new Promise((res, rej) => {
      const req = indexedDB.open("PilotLogbook_User")
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction("userSession", "readwrite")
        tx.objectStore("userSession").put({ id: "current", userId: u.userId, callsign: u.callsign, expiresAt: Date.now() + 30 * 864e5, createdAt: Date.now() })
        tx.oncomplete = () => { idb.close(); res() }
        tx.onerror = () => rej(tx.error)
      }
      req.onerror = () => rej(req.error)
    })
  }, USER)
  await page.goto(`${BASE}/logbook`)
  await page.waitForTimeout(2500)
  return { name, context, page, logs, requests }
}

/** Read a device's local IndexedDB table. */
export async function local(dev, table) {
  return dev.page.evaluate(async (table) => new Promise((res, rej) => {
    const req = indexedDB.open("PilotLogbook_User")
    req.onsuccess = () => {
      const idb = req.result
      const tx = idb.transaction(table, "readonly")
      const all = tx.objectStore(table).getAll()
      all.onsuccess = () => { idb.close(); res(all.result) }
      all.onerror = () => rej(all.error)
    }
  }), table)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function close() { await browser?.close(); await mongo.close() }
