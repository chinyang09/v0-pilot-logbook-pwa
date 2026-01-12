/**
 * Registration start request
 */
export interface RegisterStartRequest {
  callsign: string
}

/**
 * Registration start response
 */
export interface RegisterStartResponse {
  options: PublicKeyCredentialCreationOptions
  userId: string
}

/**
 * Registration complete request
 */
export interface RegisterCompleteRequest {
  userId: string
  credential: {
    id: string
    rawId: string
    response: {
      clientDataJSON: string
      attestationObject: string
    }
    type: "public-key"
  }
  totpSecret: string
  totpCode: string
}

/**
 * Login start response
 */
export interface LoginStartResponse {
  options: PublicKeyCredentialRequestOptions
}

/**
 * Login complete request
 */
export interface LoginCompleteRequest {
  credential: {
    id: string
    rawId: string
    response: {
      clientDataJSON: string
      authenticatorData: string
      signature: string
      userHandle?: string
    }
    type: "public-key"
  }
}

/**
 * Login response
 */
export interface LoginResponse {
  success: boolean
  sessionToken: string
  userId: string
  callsign: string
  expiresAt: number
  recoveryLogin?: boolean
}

/**
 * Session response
 */
export interface SessionResponse {
  authenticated: boolean
  userId?: string
  callsign?: string
  expiresAt?: number
  recoveryLogin?: boolean
}
