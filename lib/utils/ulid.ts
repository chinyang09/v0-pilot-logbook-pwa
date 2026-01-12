/**
 * ULID Generator
 * Universally Unique Lexicographically Sortable Identifier
 * Used for all domain entity IDs
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const ENCODING_LEN = ENCODING.length
const TIME_LEN = 10
const RANDOM_LEN = 16

let lastTime = 0
let lastRandom: number[] = []

/**
 * Generate a ULID
 */
export function ulid(): string {
  const now = Date.now()

  // Encode timestamp (first 10 chars)
  let timeStr = ""
  let time = now
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    timeStr = ENCODING[time % ENCODING_LEN] + timeStr
    time = Math.floor(time / ENCODING_LEN)
  }

  // Generate or increment random part
  let randomStr = ""
  if (now === lastTime && lastRandom.length === RANDOM_LEN) {
    // Increment the random part for same millisecond
    let i = RANDOM_LEN - 1
    while (i >= 0) {
      if (lastRandom[i] < ENCODING_LEN - 1) {
        lastRandom[i]++
        break
      }
      lastRandom[i] = 0
      i--
    }
  } else {
    // New millisecond - generate fresh random
    lastRandom = []
    for (let i = 0; i < RANDOM_LEN; i++) {
      lastRandom.push(Math.floor(Math.random() * ENCODING_LEN))
    }
  }

  lastTime = now
  for (let i = 0; i < RANDOM_LEN; i++) {
    randomStr += ENCODING[lastRandom[i]]
  }

  return timeStr + randomStr
}

/**
 * Extract timestamp from ULID
 */
export function ulidToTimestamp(id: string): number {
  if (id.length !== 26) return 0

  let time = 0
  const timeChars = id.substring(0, TIME_LEN).toUpperCase()

  for (let i = 0; i < TIME_LEN; i++) {
    const charIndex = ENCODING.indexOf(timeChars[i])
    if (charIndex === -1) return 0
    time = time * ENCODING_LEN + charIndex
  }

  return time
}

/**
 * Check if string is a valid ULID
 */
export function isValidUlid(id: string): boolean {
  if (id.length !== 26) return false

  for (const char of id.toUpperCase()) {
    if (!ENCODING.includes(char)) return false
  }

  return true
}
