/**
 * Crew/Personnel entity type definitions
 * USER DATA - syncs with MongoDB
 */

import type { SyncStatus } from "./flight.types"

export type CrewRole = "PIC" | "SIC" | "Instructor" | "Examiner"

export interface CrewContact {
  email?: string
  phone?: string
}

export interface Crew {
  id: string // ULID - domain identity
  userId: string // Owner's user ID

  // Identity
  name: string
  crewId?: string // Company crew ID
  organization?: string
  roles?: CrewRole[]
  licenceNumber?: string

  // Contact
  contact?: CrewContact

  // Notes
  comment?: string

  // Flags
  isMe?: boolean // Is this the current user's profile
  favorite?: boolean
  defaultPIC?: boolean
  defaultSIC?: boolean

  // Metadata
  createdAt: number
  updatedAt?: number
  syncStatus: SyncStatus
  mongoId?: string
}

// Input type for creating crew
export type CrewInput = Omit<Crew, "id" | "createdAt" | "syncStatus">

// Input type for updating crew
export type CrewUpdate = Partial<Omit<Crew, "id" | "userId" | "createdAt">>
