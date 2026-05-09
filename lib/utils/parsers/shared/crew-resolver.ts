/**
 * Resolve a (possibly truncated) crew name to a Personnel record.
 *
 * The Crew Logbook Report truncates PIC names to 20 chars. The Schedule
 * Report has full names plus crew IDs. This helper unifies both paths so
 * the logbook parser can find or create the right Personnel row.
 */

import type { Personnel } from "@/types/entities/crew.types";
import { normalize } from "./name-normalize";

export interface CrewResolveContext {
  /** Existing personnel — caller pre-loads `getAllPersonnel()`. */
  existingCrew: Personnel[];
  /** Lowercase-normalized name → personnelId. Caller maintains across calls. */
  crewCache: Map<string, string>;
  /** When set, `name` exactly matching the user is mapped to this id. */
  currentUserName?: string;
  currentUserId?: string;
  /** New rows discovered in this resolve session — caller persists them. */
  newPersonnel: Personnel[];
}

export interface CrewResolveResult {
  personnelId: string;
  resolvedName: string;
  isUser: boolean;
  /** True when we matched a Personnel row that has a longer full-name. */
  upgradedFromTruncation: boolean;
}

export function resolveCrewByName(
  rawName: string,
  ctx: CrewResolveContext
): CrewResolveResult {
  const trimmed = rawName.trim();
  const normalized = normalize(trimmed);

  if (!normalized) {
    return {
      personnelId: "",
      resolvedName: trimmed,
      isUser: false,
      upgradedFromTruncation: false,
    };
  }

  if (
    ctx.currentUserName &&
    ctx.currentUserId &&
    normalized === normalize(ctx.currentUserName)
  ) {
    return {
      personnelId: ctx.currentUserId,
      resolvedName: ctx.currentUserName,
      isUser: true,
      upgradedFromTruncation: false,
    };
  }

  // Exact normalized hit in cache.
  const cached = ctx.crewCache.get(normalized);
  if (cached) {
    const existing = ctx.existingCrew.find((p) => p.id === cached);
    return {
      personnelId: cached,
      resolvedName: existing?.name ?? trimmed,
      isUser: false,
      upgradedFromTruncation: false,
    };
  }

  // Direct (post-normalization) equality first — covers the case where the
  // input's normalized form exactly matches an existing entry.
  const direct = ctx.existingCrew.find((p) => normalize(p.name) === normalized);
  if (direct) {
    ctx.crewCache.set(normalized, direct.id);
    return {
      personnelId: direct.id,
      resolvedName: direct.name,
      isUser: false,
      upgradedFromTruncation: false,
    };
  }

  // Logbook PIC names are truncated to 20 chars. Match in BOTH directions:
  // (a) existing full name starts with input (input is truncated logbook),
  // (b) input starts with existing (existing was created truncated, input
  //     is now the full schedule form).
  // Pick the longest matching candidate — if multiple existing rows match
  // by prefix, the longest-named one is most specific.
  let bestPrefix: Personnel | null = null;
  let bestPrefixLen = 0;
  for (const p of ctx.existingCrew) {
    const fullNorm = normalize(p.name);
    if (!fullNorm) continue;

    const aStartsWithB = fullNorm.startsWith(normalized);
    const bStartsWithA = normalized.startsWith(fullNorm);
    if (!aStartsWithB && !bStartsWithA) continue;
    if (fullNorm.length === normalized.length) continue; // already direct-handled

    // Require a meaningful overlap (at least 6 alphanumeric chars). This
    // avoids matching e.g. "Tan" against every name starting with "tan".
    const overlap = Math.min(fullNorm.length, normalized.length);
    if (overlap < 6) continue;

    if (fullNorm.length > bestPrefixLen) {
      bestPrefix = p;
      bestPrefixLen = fullNorm.length;
    }
  }
  if (bestPrefix) {
    ctx.crewCache.set(normalized, bestPrefix.id);
    // Pick the longer of (existing, input) as the resolved canonical form.
    const fullForm =
      bestPrefix.name.length >= trimmed.length ? bestPrefix.name : trimmed;
    return {
      personnelId: bestPrefix.id,
      resolvedName: fullForm,
      isUser: false,
      upgradedFromTruncation: bestPrefix.name.length > trimmed.length,
    };
  }

  // Create a new Personnel row (truncated until schedule arrives).
  const newPerson: Personnel = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: Date.now(),
    syncStatus: "pending",
    isMe: false,
    roles: ["PIC"],
  };
  ctx.newPersonnel.push(newPerson);
  ctx.existingCrew.push(newPerson);
  ctx.crewCache.set(normalized, newPerson.id);

  return {
    personnelId: newPerson.id,
    resolvedName: newPerson.name,
    isUser: false,
    upgradedFromTruncation: false,
  };
}
