import * as h from "./harness.mjs"

export async function createFlight(dev) {
  await dev.page.locator('button[aria-label="Add flight"]').click()
  await dev.page.waitForURL(/selected=/, { timeout: 15000 })
  const id = new URL(dev.page.url()).searchParams.get("selected")
  await dev.page.locator('input[placeholder="-"]').first().waitFor({ timeout: 15000 })
  await h.sleep(1500) // the form's auto-save baseline is taken from its first debounced state
  return id
}

export async function openFlight(dev, id) {
  await dev.page.goto(`${h.BASE}/logbook?selected=${id}`)
  await dev.page.locator('input[placeholder="-"]').first().waitFor({ timeout: 20000 })
  await h.sleep(1500)
}

/** Type into the Flight # row and commit it (blur), like a pilot would. */
export async function setFlightNumber(dev, value) {
  const input = dev.page.locator('input[placeholder="-"]').first()
  await input.focus()
  await input.fill(value)
  await input.press("Enter")
  await input.evaluate((el) => el.blur())
}

export async function getLocal(dev, table, id) {
  return dev.page.evaluate(async ({ table, id }) => new Promise((res) => {
    const req = indexedDB.open("PilotLogbook_User")
    req.onsuccess = () => {
      const idb = req.result
      const g = idb.transaction(table, "readonly").objectStore(table).get(id)
      g.onsuccess = () => { idb.close(); res(g.result) }
    }
  }), { table, id })
}

/** Poll until `pred` holds; returns elapsed ms, or -1 on timeout. */
export async function until(pred, timeoutMs = 60000, every = 500) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { if (await pred()) return Date.now() - t0 } catch {}
    await h.sleep(every)
  }
  return -1
}

/** Tap NOW on the time row with this label ("Out", "Off", "On", "In"). */
export async function tapNow(dev, rowLabel) {
  const ok = await dev.page.evaluate((label) => {
    for (const btn of document.querySelectorAll("button")) {
      if (btn.textContent?.trim() !== "NOW" || !btn.offsetParent) continue
      let el = btn.parentElement
      for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
        const first = el.innerText?.split("\n")[0]?.trim()
        if (first === label) { btn.scrollIntoView(); btn.click(); return true }
        if (first && first !== "NOW" && first !== "UTC" && !/^[-:\d ]+$/.test(first)) break
      }
    }
    return false
  }, rowLabel)
  if (!ok) throw new Error(`no NOW button for ${rowLabel}`)
}
