/**
 * Currency/Expiry store operations
 */

import { userDb } from "../../user-db"
import type {
  Currency,
  CurrencyCreate,
  CurrencyStatus,
  CurrencyWithStatus,
} from "@/types/entities/roster.types"
import { addToSyncQueue, getDeviceId } from "./sync-queue.store"
import {
  updateEntity,
  deleteEntity,
  silentDeleteEntity,
  upsertFromServer,
  restoreEntity,
  purgeEntity,
  purgeExpiredEntities,
  isLiveEntity,
} from "./crud-helpers";

/**
 * Calculate currency status based on expiry date
 */
export function getCurrencyStatus(currency: Currency): CurrencyWithStatus {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const expiryDate = new Date(currency.expiryDate)
  expiryDate.setHours(0, 0, 0, 0)

  const diffTime = expiryDate.getTime() - today.getTime()
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  let status: CurrencyStatus
  if (daysRemaining < 0) {
    status = "expired"
  } else if (daysRemaining <= currency.criticalDays) {
    status = "critical"
  } else if (daysRemaining <= currency.warningDays) {
    status = "warning"
  } else {
    status = "valid"
  }

  return {
    ...currency,
    status,
    daysRemaining,
  }
}

/**
 * Add new currency
 */
export async function addCurrency(currency: CurrencyCreate): Promise<Currency> {
  const newCurrency: Currency = {
    ...currency,
    id: crypto.randomUUID(),
    warningDays: currency.warningDays ?? 30,
    criticalDays: currency.criticalDays ?? 7,
    autoUpdate: currency.autoUpdate ?? true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deviceId: await getDeviceId(),
    syncStatus: "pending",
  }

  await userDb.currencies.put(newCurrency)
  await addToSyncQueue("create", "currencies", newCurrency)

  return newCurrency
}

/**
 * Update existing currency
 */
export async function updateCurrency(
  id: string,
  updates: Partial<Currency>
): Promise<Currency | null> {
  return updateEntity<Currency>(userDb.currencies, "currencies", id, updates)
}

/**
 * Delete currency
 */
export async function deleteCurrency(id: string): Promise<boolean> {
  return deleteEntity<Currency>(userDb.currencies, "currencies", id)
}

/**
 * Delete currency without enqueuing (server-initiated)
 */
export async function silentDeleteCurrency(id: string): Promise<boolean> {
  return silentDeleteEntity<Currency>(userDb.currencies, id)
}

/**
 * Put a soft-deleted currency back — see `deleteCurrency`.
 */
export async function restoreCurrency(id: string): Promise<boolean> {
  return restoreEntity<Currency>(userDb.currencies, "currencies", id);
}

/** Destroy it now rather than in 30 days. Writes a tombstone. */
export async function permanentlyDeleteCurrency(id: string): Promise<boolean> {
  return purgeEntity<Currency>(userDb.currencies, "currencies", id);
}

/** Sweep whatever has run out its 30 days. */
export async function purgeExpiredDeletedCurrency(): Promise<number> {
  return purgeExpiredEntities<Currency>(userDb.currencies, "currencies");
}

/** Everything currently in Recently Deleted, newest first. */
export async function getDeletedCurrency(): Promise<Currency[]> {
  const all = await userDb.currencies.toArray();
  return all
    .filter((e) => e.deletedAt != null)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}


/**
 * Get all currencies
 */
export async function getAllCurrencies(): Promise<Currency[]> {
  // LIVE rows only — see isLiveEntity.
  return (await userDb.currencies.toArray()).filter(isLiveEntity)
}

/**
 * Get all currencies with status
 */
export async function getAllCurrenciesWithStatus(): Promise<CurrencyWithStatus[]> {
  return (await getAllCurrencies()).map(getCurrencyStatus)
}

/**
 * Get currency by ID
 */
export async function getCurrencyById(id: string): Promise<Currency | undefined> {
  return userDb.currencies.get(id)
}

/**
 * Get currency by code
 */
export async function getCurrencyByCode(code: string): Promise<Currency | undefined> {
  // A deleted currency must not answer a lookup by code, or re-adding the same
  // certificate silently edits the binned one instead of creating a new row.
  const rows = await userDb.currencies.where("code").equals(code).toArray()
  return rows.find(isLiveEntity)
}

/**
 * Get expiring currencies (warning or critical)
 */
export async function getExpiringCurrencies(): Promise<CurrencyWithStatus[]> {
  const all = await getAllCurrenciesWithStatus()
  return all.filter((c) => c.status === "warning" || c.status === "critical")
}

/**
 * Get expired currencies
 */
export async function getExpiredCurrencies(): Promise<CurrencyWithStatus[]> {
  const all = await getAllCurrenciesWithStatus()
  return all.filter((c) => c.status === "expired")
}

/**
 * Get currencies sorted by expiry date
 */
export async function getCurrenciesSortedByExpiry(): Promise<CurrencyWithStatus[]> {
  const currencies = await userDb.currencies.orderBy("expiryDate").toArray()
  return currencies.map(getCurrencyStatus)
}

/**
 * Upsert currency (update if exists by code, create if not)
 */
export async function upsertCurrency(
  currency: CurrencyCreate
): Promise<{ currency: Currency; isNew: boolean }> {
  const existing = await userDb.currencies.where("code").equals(currency.code).first()

  if (existing) {
    // Only update if autoUpdate is enabled
    if (existing.autoUpdate) {
      const updated = await updateEntity<Currency>(userDb.currencies, "currencies", existing.id, {
        expiryDate: currency.expiryDate,
        description: currency.description,
        lastUpdatedFrom: currency.lastUpdatedFrom,
      })
      return { currency: updated ?? existing, isNew: false }
    }
    return { currency: existing, isNew: false }
  }

  const created = await addCurrency(currency)
  return { currency: created, isNew: true }
}

/**
 * Bulk upsert currencies from schedule import
 */
export async function bulkUpsertCurrencies(
  currencies: CurrencyCreate[]
): Promise<{ created: number; updated: number }> {
  let created = 0
  let updated = 0

  for (const currency of currencies) {
    const result = await upsertCurrency(currency)
    if (result.isNew) created++
    else updated++
  }

  return { created, updated }
}

/**
 * Clear all currencies
 */
export async function clearAllCurrencies(): Promise<void> {
  await userDb.currencies.clear()
}

/**
 * Get currencies count
 */
export async function getCurrenciesCount(): Promise<number> {
  return (await getAllCurrencies()).length
}

/**
 * Normalize a server currency record (fill required defaults).
 */
function normalizeCurrencyFromServer(server: Currency): Currency {
  return {
    ...server,
    warningDays: server.warningDays ?? 30,
    criticalDays: server.criticalDays ?? 7,
    autoUpdate: server.autoUpdate ?? true,
    createdAt: server.createdAt || Date.now(),
    updatedAt: server.updatedAt,
    syncStatus: "synced",
  }
}

/**
 * Upsert a currency from server (for sync)
 */
export async function upsertCurrencyFromServer(server: Currency): Promise<void> {
  return upsertFromServer<Currency>(userDb.currencies, server, normalizeCurrencyFromServer)
}
