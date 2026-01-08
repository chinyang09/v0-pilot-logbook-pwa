/**
 * Personnel domain types
 */

export interface Personnel {
  id: string
  userId?: string
  name: string
  crewId?: string
  organization?: string
  roles?: ("PIC" | "SIC" | "Instructor" | "Examiner")[]
  licenceNumber?: string
  contact?: {
    email?: string
    phone?: string
  }
  comment?: string
  isMe?: boolean
  favorite?: boolean
  defaultPIC?: boolean
  defaultSIC?: boolean
  createdAt: number
  updatedAt?: number
  syncStatus: "synced" | "pending" | "error"
  mongoId?: string
}
