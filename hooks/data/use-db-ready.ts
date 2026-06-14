"use client"

/**
 * Re-export of the canonical DB-ready primitives from `use-db`.
 *
 * This module previously held its OWN `dbInitialized`/`dbInitPromise` module
 * state and a duplicate `checkDBReady`/`useDBReady`. Because some hooks import
 * from here and others from `use-db`, that meant two independent init promises
 * and `initializeDB()` could run twice. There is now a single source of truth.
 */
export { checkDBReady, useDBReady } from "./use-db"
