/**
 * Database exports
 * Import databases from here: import { userDb, referenceDb } from "@/lib/db"
 */

export { userDb, initializeUserDb } from "./user-db"
export { referenceDb, initializeReferenceDb } from "./reference-db"

// Re-export stores
export * from "./stores/flights.store"
export * from "./stores/crew.store"
export * from "./stores/aircraft.store"
export * from "./stores/sessions.store"
export * from "./stores/preferences.store"
export * from "./stores/sync-queue.store"

/**
 * Initialize both databases
 */
export async function initializeDatabases(): Promise<boolean> {
  const { initializeUserDb } = await import("./user-db")
  const { initializeReferenceDb } = await import("./reference-db")

  const [userOk, refOk] = await Promise.all([initializeUserDb(), initializeReferenceDb()])

  return userOk && refOk
}
