/**
 * A tiny in-memory stand-in for the slice of the MongoDB driver the sync engine
 * uses — enough to run push, pull and the migration end to end in a unit test.
 * Not a general Mongo: it implements exactly the operators the engine sends.
 */

import { ObjectId } from "mongodb"

type Doc = Record<string, unknown>

/** Deep copy that keeps ObjectId and Date instances (structuredClone strips their class). */
function clone<T>(v: T): T {
  if (v instanceof ObjectId || v instanceof Date || v === null || typeof v !== "object") return v
  if (Array.isArray(v)) return v.map(clone) as T
  return Object.fromEntries(Object.entries(v as Doc).map(([k, x]) => [k, clone(x)])) as T
}

function cmp(a: unknown, b: unknown): number {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.toHexString() < b.toHexString() ? -1 : a.equals(b) ? 0 : 1
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a) < String(b) ? -1 : String(a) === String(b) ? 0 : 1
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) return a instanceof ObjectId && b instanceof ObjectId && a.equals(b)
  return a === b
}

function matches(doc: Doc, query: Doc): boolean {
  for (const [key, cond] of Object.entries(query)) {
    if (key === "$or") {
      if (!(cond as Doc[]).some((q) => matches(doc, q))) return false
      continue
    }
    const value = doc[key]
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !(cond instanceof Date)) {
      for (const [op, arg] of Object.entries(cond as Doc)) {
        if (op === "$gt" && !(value !== undefined && cmp(value, arg) > 0)) return false
        if (op === "$in" && !(arg as unknown[]).some((a) => eq(a, value))) return false
        if (op === "$ne" && eq(value, arg)) return false
        if (op === "$exists" && (value !== undefined) !== arg) return false
      }
    } else if (!eq(value ?? null, cond ?? null)) {
      return false
    }
  }
  return true
}

function applyUpdate(doc: Doc, update: Doc, inserting: boolean) {
  for (const [op, fields] of Object.entries(update)) {
    for (const [k, v] of Object.entries(fields as Doc)) {
      if (op === "$set") doc[k] = v
      else if (op === "$setOnInsert" && inserting) doc[k] = v
      else if (op === "$inc") doc[k] = ((doc[k] as number) ?? 0) + (v as number)
      else if (op === "$max") doc[k] = doc[k] === undefined || cmp(v, doc[k]) > 0 ? v : doc[k]
    }
  }
}

class FakeCursor {
  private docs: Doc[]
  constructor(docs: Doc[]) {
    this.docs = docs
  }
  sort(spec: Record<string, 1 | -1>) {
    const keys = Object.entries(spec)
    this.docs.sort((a, b) => {
      for (const [k, dir] of keys) {
        const c = cmp(a[k], b[k])
        if (c !== 0) return c * dir
      }
      return 0
    })
    return this
  }
  limit(n: number) {
    this.docs = this.docs.slice(0, n)
    return this
  }
  project() {
    return this
  }
  async toArray() {
    return this.docs.map((d) => clone(d))
  }
}

export class FakeCollection {
  docs: Doc[] = []

  find(query: Doc = {}) {
    return new FakeCursor(this.docs.filter((d) => matches(d, query)))
  }
  async findOne(query: Doc) {
    const d = this.docs.find((x) => matches(x, query))
    return d ? clone(d) : null
  }
  async findOneAndUpdate(filter: Doc, update: Doc, opts: { upsert?: boolean } = {}) {
    let doc = this.docs.find((x) => matches(x, filter))
    const inserting = !doc
    if (!doc) {
      if (!opts.upsert) return null
      doc = { ...filter }
      this.docs.push(doc)
    }
    applyUpdate(doc, update, inserting)
    return clone(doc)
  }
  async updateOne(filter: Doc, update: Doc, opts: { upsert?: boolean } = {}) {
    await this.findOneAndUpdate(filter, update, opts)
  }
  async insertMany(docs: Doc[]) {
    for (const d of docs) this.docs.push({ _id: new ObjectId(), ...clone(d) })
  }
  async updateMany() {
    // Only `ensureBackfilled` uses this, and the tests mark backfill done.
  }
  async bulkWrite(ops: Doc[]) {
    for (const op of ops) {
      const [kind, arg] = Object.entries(op)[0] as [string, Doc]
      if (kind === "replaceOne") {
        const i = this.docs.findIndex((x) => matches(x, arg.filter as Doc))
        if (i >= 0) this.docs[i] = { _id: this.docs[i]._id, ...clone(arg.replacement as Doc) }
        else if (arg.upsert) this.docs.push({ _id: new ObjectId(), ...clone(arg.replacement as Doc) })
      } else if (kind === "updateOne") {
        let doc = this.docs.find((x) => matches(x, arg.filter as Doc))
        const inserting = !doc
        if (!doc && arg.upsert) {
          doc = { _id: new ObjectId(), ...(arg.filter as Doc) }
          this.docs.push(doc)
        }
        if (doc) applyUpdate(doc, arg.update as Doc, inserting)
      } else if (kind === "deleteOne") {
        const i = this.docs.findIndex((x) => matches(x, arg.filter as Doc))
        if (i >= 0) this.docs.splice(i, 1)
      } else if (kind === "insertOne") {
        this.docs.push(clone(arg.document as Doc))
      }
    }
  }
}

export class FakeDb {
  collections = new Map<string, FakeCollection>()
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection())
    return this.collections.get(name)!
  }
}

export const fakeClient = {
  startSession: () => ({
    withTransaction: async (fn: () => Promise<void>) => fn(),
    endSession: async () => {},
  }),
}
