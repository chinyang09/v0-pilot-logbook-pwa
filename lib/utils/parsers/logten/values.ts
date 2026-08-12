/**
 * Value coercion + sanitisation for LogTen Pro exports.
 *
 * Every function here takes whatever the file actually contained — including
 * `undefined` for a short row — and returns a value the PWA's own types will
 * accept, or a documented empty form. NOTHING throws: a corrupt cell degrades
 * to a blank, and the row-level parsers decide whether that blank is fatal.
 * That is what keeps a single bad line from taking down a 4,000-flight
 * migration.
 */

/** Month names LogTen may write when the OS locale uses a medium date style. */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Trim, drop wrapping quotes, and collapse internal whitespace runs.
 *
 * LogTen pads several columns with a single leading space (` Full Name`,
 * ` PIC`, ` Lim Chin Yang`) — visible in the header AND the values — so an
 * untrimmed compare against "PIC" misses every row.
 */
export function text(value: string | undefined | null): string {
  if (value == null) return "";
  // Order matters: the quotes have to be stripped from an ALREADY-trimmed
  // string, or a padded cell (` "Ong Kok Boon" `) keeps them — the anchors
  // never reach a quote that has a space in front of it.
  return String(value)
    .replace(/^﻿/, "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function upper(value: string | undefined | null): string {
  return text(value).toUpperCase();
}

/**
 * A number, with thousands separators removed (`"1,178.1"` → `1178.1`).
 * Returns `null` rather than NaN so a caller can tell "absent" from "zero".
 */
export function toNumber(value: string | undefined | null): number | null {
  const raw = text(value).replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function toInt(value: string | undefined | null, fallback = 0): number {
  const n = toNumber(value);
  return n == null ? fallback : Math.round(n);
}

/**
 * LogTen writes booleans as `1` (and leaves the cell empty for false), but
 * hand-edited exports show up with `true`/`yes`/`x` too.
 */
export function toBool(value: string | undefined | null): boolean {
  const raw = text(value).toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "y" || raw === "x";
}

export type DateOrder = "auto" | "dmy" | "mdy";

/**
 * A date in `YYYY-MM-DD`, or `""` when the cell isn't a date at all.
 *
 * LogTen's tab export writes ISO already, which is unambiguous and the case
 * that matters. The slash forms are accepted because a user can re-save an
 * export through a spreadsheet, which rewrites dates in the OS locale — and
 * there `13/05/2026` and `05/13/2026` mean the same day written two ways.
 * `order` resolves that; `"auto"` reads the day field when it is > 12 and
 * otherwise falls back to `dmy`.
 */
export function toIsoDate(
  value: string | undefined | null,
  order: DateOrder = "auto"
): string {
  const raw = text(value);
  if (!raw) return "";

  // ISO, the LogTen tab-export form.
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return assemble(+iso[1], +iso[2], +iso[3]);

  // 13-May-2026 / 13 May 2026 / May 13, 2026
  const named = raw.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{2,4})$/);
  if (named) {
    const month = MONTHS[named[2].toLowerCase().slice(0, 4)] ?? MONTHS[named[2].toLowerCase().slice(0, 3)];
    if (month) return assemble(expandYear(+named[3]), month, +named[1]);
  }
  const namedFirst = raw.match(/^([A-Za-z]{3,9})[\s-]+(\d{1,2}),?[\s-]+(\d{2,4})$/);
  if (namedFirst) {
    const month =
      MONTHS[namedFirst[1].toLowerCase().slice(0, 4)] ??
      MONTHS[namedFirst[1].toLowerCase().slice(0, 3)];
    if (month) return assemble(expandYear(+namedFirst[3]), month, +namedFirst[2]);
  }

  // Numeric, locale-ordered.
  const slash = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (slash) {
    const a = +slash[1];
    const b = +slash[2];
    const year = expandYear(+slash[3]);
    const dayFirst =
      order === "dmy" ? true : order === "mdy" ? false : a > 12 || b > 12 ? a > 12 : true;
    return dayFirst ? assemble(year, b, a) : assemble(year, a, b);
  }

  return "";
}

function expandYear(year: number): number {
  if (year >= 1000) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function assemble(year: number, month: number, day: number): string {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A DURATION in `HH:MM`, allowing 24 hours or more (a LogTen totals row can
 * carry four figures). Returns `""` for an absent or unreadable cell —
 * NEVER "00:00", because the parsers distinguish "the column was blank" from
 * "the pilot logged zero", and only the former should be recomputed.
 *
 * Accepts `4:00`, `04:00`, `1:5`, `130` (H:MM run together), and the decimal
 * hours (`1.5`) some LogTen configurations write.
 */
export function toDuration(value: string | undefined | null): string {
  const raw = text(value).replace(/[\s,]/g, "");
  if (!raw) return "";

  const colon = raw.match(/^(\d{1,4}):([0-5]?\d)$/);
  if (colon) return pad(+colon[1], +colon[2]);

  // Decimal hours — "1.5" is an hour and a half, not "01:05".
  const decimal = raw.match(/^(\d{1,4})\.(\d{1,2})$/);
  if (decimal) {
    const hours = +decimal[1];
    const minutes = Math.round(Number(`0.${decimal[2]}`) * 60);
    return pad(hours + Math.floor(minutes / 60), minutes % 60);
  }

  // Bare digits: the last two are minutes.
  const bare = raw.match(/^(\d{1,2})(\d{2})$/);
  if (bare && +bare[2] < 60) return pad(+bare[1], +bare[2]);

  return "";
}

/**
 * A CLOCK time in `HH:MM`, i.e. a point in the day, so it must land inside
 * 00:00–23:59. Anything outside is a duration in a time column (or noise) and
 * comes back `""` rather than silently wrapping into the wrong hour.
 *
 * Accepts a trailing `Z`, and the 12-hour form a spreadsheet round-trip adds.
 */
export function toClock(value: string | undefined | null): string {
  let raw = text(value).replace(/\s+/g, " ").toUpperCase();
  if (!raw) return "";

  let meridiem: "AM" | "PM" | null = null;
  const ampm = raw.match(/\b(AM|PM)\b/);
  if (ampm) {
    meridiem = ampm[1] as "AM" | "PM";
    raw = raw.replace(/\b(AM|PM)\b/, "").trim();
  }
  raw = raw.replace(/[ZL]$/, "").replace(/\s/g, "");

  let hours: number;
  let minutes: number;
  const colon = raw.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
  if (colon) {
    hours = +colon[1];
    minutes = +colon[2];
  } else {
    const bare = raw.match(/^(\d{1,2})([0-5]\d)$/);
    if (!bare) return "";
    hours = +bare[1];
    minutes = +bare[2];
  }

  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;

  if (hours > 23 || minutes > 59) return "";
  return pad(hours, minutes);
}

function pad(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Minutes in a `HH:MM` duration. `""` → 0. */
export function durationMinutes(hhmm: string): number {
  const parts = hhmm.split(":");
  if (parts.length !== 2) return 0;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

/** True when the duration string represents more than zero minutes. */
export function hasTime(hhmm: string): boolean {
  return durationMinutes(hhmm) > 0;
}
