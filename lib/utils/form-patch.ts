/**
 * What an edit form may write back, and how it follows the row underneath it.
 *
 * A form holds a COPY of a record. Saving that whole copy is how one device
 * used to undo another's work without anybody touching anything: the iPad has
 * flight 123 open, the phone changes its OUT time and signs it, the iPad pulls
 * the new row within seconds — and the next auto-save sends the iPad's old
 * OUT time and no signature back as though the pilot had typed them. The sync
 * engine can't tell that from a real edit, because the diff is taken against
 * the freshly pulled row and the base is the freshly pulled seq.
 *
 * So a form keeps a BASELINE — the record as it stood when the form last
 * agreed with the database — and writes only what differs from it
 * (`formPatch`). When the row changes underneath, every field the user has
 * not touched follows it, in the form and in the baseline alike
 * (`rebaseForm`); a field the user HAS touched keeps their value and goes up
 * as an edit, where the server arbitrates it against the other device's.
 */

import { sameValue } from "@/lib/sync/changes"

/** Bookkeeping a form never authors, whatever its copy says. */
export const FORM_UNSENT_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "userId",
  "createdAt",
  "updatedAt",
  "deviceId",
  "syncStatus",
  "serverSeq",
  "deletedAt",
])

type Row = Record<string, unknown>

function keysOf(...rows: Row[]): string[] {
  const keys = new Set<string>()
  for (const row of rows) for (const k of Object.keys(row)) keys.add(k)
  return [...keys]
}

/** The fields the form changed since its baseline — and only those. */
export function formPatch<T extends object>(current: Partial<T>, baseline: Partial<T>): Partial<T> {
  const cur = current as Row
  const base = baseline as Row
  const patch: Row = {}
  for (const key of keysOf(cur, base)) {
    if (FORM_UNSENT_FIELDS.has(key)) continue
    if (!sameValue(cur[key], base[key])) patch[key] = cur[key]
  }
  return patch as Partial<T>
}

/**
 * Bring a form up to date with a row that changed underneath it. A field the
 * row changed is adopted — into the form AND the baseline, so it is not then
 * saved back as an edit — unless the user has changed it themselves since
 * the baseline. `alwaysAdopt` names fields only ever written straight to the
 * database (the pickers), where the row IS the user's latest choice.
 */
export function rebaseForm<T extends object>(args: {
  form: Partial<T>
  baseline: Partial<T>
  previous: Partial<T>
  live: Partial<T>
  alwaysAdopt?: ReadonlySet<string>
}): { form: Partial<T>; baseline: Partial<T>; adopted: string[] } {
  const form = { ...(args.form as Row) }
  const baseline = { ...(args.baseline as Row) }
  const prev = args.previous as Row
  const live = args.live as Row
  const adopted: string[] = []
  for (const key of keysOf(prev, live)) {
    if (sameValue(prev[key], live[key])) continue
    const untouched = sameValue(form[key], baseline[key])
    if (!untouched && !args.alwaysAdopt?.has(key)) continue
    if (live[key] === undefined) {
      delete form[key]
      delete baseline[key]
    } else {
      form[key] = live[key]
      baseline[key] = live[key]
    }
    adopted.push(key)
  }
  return { form: form as Partial<T>, baseline: baseline as Partial<T>, adopted }
}
