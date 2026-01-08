/**
 * ULID Generator
 * Generates time-sortable unique identifiers for domain entities
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const ENCODING_LEN = ENCODING.length
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(now: number, len: number): string {
  let str = ""
  for (let i = len; i > 0; i--) {
    const mod = now % ENCODING_LEN
    str = ENCODING[mod] + str
    now = Math.floor(now / ENCODING_LEN)
  }
  return str
}

function encodeRandom(len: number): string {
  let str = ""
  const randomBytes = crypto.getRandomValues(new Uint8Array(len))
  for (let i = 0; i < len; i++) {
    str += ENCODING[randomBytes[i] % ENCODING_LEN]
  }
  return str
}

export function generateULID(): string {
  const time = encodeTime(Date.now(), TIME_LEN)
  const random = encodeRandom(RANDOM_LEN)
  return time + random
}

export function extractTimestamp(ulid: string): number {
  if (ulid.length !== 26) return 0

  let time = 0
  const timeChars = ulid.slice(0, TIME_LEN)
  for (let i = 0; i < timeChars.length; i++) {
    time = time * ENCODING_LEN + ENCODING.indexOf(timeChars[i])
  }
  return time
}
