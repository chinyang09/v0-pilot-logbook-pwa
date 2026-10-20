/**
 * Keyboard hints for a field that takes a CODE — a flight number, a
 * registration, an ICAO or type designator, a runway, a duty code.
 *
 * Without them a phone keyboard treats "TR600" or "WSSS" as a misspelt word:
 * iOS autocorrects it as you type, and both platforms start the field in
 * lower case, so a code that the field upper-cases anyway is typed with the
 * shift key fighting you.
 */
export const CODE_INPUT_PROPS = {
  autoCapitalize: "characters",
  autoCorrect: "off",
  autoComplete: "off",
  spellCheck: false,
} as const

/** A search box: free text (names, routes, codes), never "corrected". */
export const SEARCH_INPUT_PROPS = {
  autoCapitalize: "none",
  autoCorrect: "off",
  autoComplete: "off",
  spellCheck: false,
} as const
