import type { Personnel } from "@/types/entities/crew.types"

/**
 * THE pilot's own crew card, decided the same way on every device.
 *
 * Only one card is meant to say "This is me", and the form unsets the old one
 * when another is chosen — but two devices can each choose a different card
 * before they sync, and both flags then arrive everywhere. Every reader used
 * to take the FIRST flagged card in table order, which differs per device, so
 * the seat a new flight started in (and the role an import assigned) depended
 * on which device you were holding. The most recently changed flagged card
 * wins, ties broken by id: the same answer everywhere, and the one the pilot
 * touched last.
 */
export function pickSelfCard<T extends Pick<Personnel, "id" | "isMe" | "updatedAt" | "deletedAt">>(
  personnel: readonly T[]
): T | null {
  let best: T | null = null
  for (const p of personnel) {
    if (!p.isMe || p.deletedAt != null) continue
    if (
      !best ||
      (p.updatedAt ?? 0) > (best.updatedAt ?? 0) ||
      ((p.updatedAt ?? 0) === (best.updatedAt ?? 0) && p.id > best.id)
    ) {
      best = p
    }
  }
  return best
}
