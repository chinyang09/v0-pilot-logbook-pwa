/**
 * WebAuthn-related types
 */

export type { AuthenticatorTransport } from "../entities/user.types"

export interface WebAuthnRegistrationOptions {
  challenge: string
  rp: {
    name: string
    id: string
  }
  user: {
    id: string
    name: string
    displayName: string
  }
  pubKeyCredParams: Array<{
    type: "public-key"
    alg: number
  }>
  timeout?: number
  attestation?: AttestationConveyancePreference
  authenticatorSelection?: AuthenticatorSelectionCriteria
}

export interface WebAuthnAuthenticationOptions {
  challenge: string
  timeout?: number
  rpId?: string
  allowCredentials?: Array<{
    type: "public-key"
    id: string
    transports?: AuthenticatorTransport[]
  }>
  userVerification?: UserVerificationRequirement
}

export interface WebAuthnCredentialResponse {
  id: string
  rawId: string
  response: {
    clientDataJSON: string
    attestationObject?: string
    authenticatorData?: string
    signature?: string
    userHandle?: string
  }
  type: "public-key"
  authenticatorAttachment?: AuthenticatorAttachment
}
