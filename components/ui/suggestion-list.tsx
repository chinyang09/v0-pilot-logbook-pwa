"use client"

/**
 * The one list of choices under a field — the ICAO type matches under Type
 * Code, the aircraft a partial registration could be, the airports a partial
 * code could be. It replaced a bordered web dropdown per screen (`hover:bg-accent`,
 * full-width rules, 32px rows) and is a grouped list in the rows' own
 * vocabulary: an inset well, inset dividers, rows a thumb can hit (44px), and
 * the qualifier as a capsule.
 */

export interface SuggestionItem {
  key: string
  /** The value the row stands for — bold, first. */
  title: string
  /** One qualifier in a capsule (a type description, a type code). */
  badge?: string
  /** Short facts after the capsule. */
  meta?: string[]
  /** The second line. */
  subtitle?: string
}

export function SuggestionList({
  items,
  label,
  onSelect,
}: {
  items: SuggestionItem[]
  /** What the list holds, for a screen reader ("Matching aircraft types"). */
  label: string
  onSelect: (key: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div role="listbox" aria-label={label} className="mt-2 max-h-56 overflow-y-auto overscroll-contain rounded-xl bg-muted/40">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onSelect(item.key)}
          className="row-divider block min-h-11 w-full px-4 py-2.5 text-left transition-colors active:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{item.title}</span>
            {item.badge && (
              <span className="truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{item.badge}</span>
            )}
            {item.meta?.map((m) => (
              <span key={m} className="shrink-0 text-xs text-muted-foreground">
                {m}
              </span>
            ))}
          </span>
          {item.subtitle && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
        </button>
      ))}
    </div>
  )
}
