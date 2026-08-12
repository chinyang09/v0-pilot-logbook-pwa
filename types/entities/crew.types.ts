/**
 * Crew/Personnel-related type definitions
 */

import type { SyncStatus } from "./flight.types"

export type PersonnelRole = "PIC" | "SIC" | "Instructor" | "Examiner"

export interface PersonnelContact {
  email?: string
  phone?: string
}

export interface Personnel {
  id: string
  userId?: string
  name: string
  crewId?: string
  organization?: string
  roles?: PersonnelRole[]
  licenceNumber?: string
  contact?: PersonnelContact
  comment?: string
  isMe?: boolean
  favorite?: boolean
  defaultPIC?: boolean
  defaultSIC?: boolean
  createdAt: number
  updatedAt?: number
  /** Soft-delete stamp — the row is in Recently Deleted. `null` when cleared,
   *  never undefined (see SyncableEntity). */
  deletedAt?: number | null
  syncStatus: SyncStatus
  // Sync engine: server-authored monotonic version (delta cursor) + authoring device (LWW tiebreak)
  serverSeq?: number
  deviceId?: string
}

export type PersonnelCreate = Omit<Personnel, "id" | "createdAt" | "syncStatus">
export type PersonnelUpdate = Partial<Personnel>
