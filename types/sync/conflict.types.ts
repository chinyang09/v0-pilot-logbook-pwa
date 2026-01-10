/**
 * Conflict resolution types
 */

import type { FlightLog } from "../entities/flight.types"
import type { Aircraft } from "../entities/aircraft.types"
import type { Personnel } from "../entities/crew.types"

export type ConflictEntity = FlightLog | Aircraft | Personnel

export interface ConflictResolution {
  id: string
  collection: "flights" | "aircraft" | "personnel"
  localVersion: ConflictEntity
  serverVersion: ConflictEntity
  resolvedVersion?: ConflictEntity
  resolution: "local" | "server" | "merge" | "pending"
  resolvedAt?: number
}

export interface MergeStrategy {
  preferLocal: string[] // Field names to prefer local version
  preferServer: string[] // Field names to prefer server version
  custom?: Record<string, (local: any, server: any) => any>
}
