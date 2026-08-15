/**
 * The FIRST SCHEDULE (Regulation 2) definitions, as code.
 *
 * These are not helper utilities — they are the vocabulary the Fifth Schedule
 * is written in, and every one of them was previously an assumption somewhere
 * in this codebase. Three of those assumptions were wrong:
 *
 * | Term | What the code assumed | What the schedule says |
 * |---|---|---|
 * | local night | a fixed 22:00–06:00 SGT window | an 8-hour period falling between **2200 and 0800** local |
 * | rest start | 30 minutes after gate-in | **one hour after the crew member is free of all duties** |
 * | acclimated | within 2 hours of home base | **3 consecutive local nights free of duty in a time zone** |
 *
 * Everything here is pure and works in absolute UTC instants plus a zone
 * offset, because "local time" in these definitions means local time somewhere
 * specific and the caller is the only thing that knows where.
 */

/* ── Local night ─────────────────────────────────────────────────────────── */

/**
 * "**Local night**" means a period of 8 hours falling between 2200 hours and
 * 0800 hours local time.
 *
 * Note the shape: the *window* is ten hours wide (2200 → 0800) and a local
 * night is any eight contiguous hours inside it. The old code modelled the
 * night as a fixed 22:00–06:00 band, which is one particular local night
 * rather than the definition — so rest that ran, say, 00:30 → 08:30 contained
 * a full eight hours between 2200 and 0800 and was still reported as having no
 * local night, taking the requirement from 10 hours to 12.
 */
export const LOCAL_NIGHT_WINDOW_START_MIN = 22 * 60
export const LOCAL_NIGHT_WINDOW_END_MIN = 32 * 60 // 0800 the following day
export const LOCAL_NIGHT_DURATION_MIN = 8 * 60

const DAY_MS = 86_400_000
const MIN_MS = 60_000

/**
 * Does an interval contain a local night?
 *
 * True when some 8 contiguous hours of the interval fall inside a single
 * 2200→0800 local window. Because both the interval and the window are
 * contiguous, that reduces to: their overlap is at least 8 hours.
 *
 * @param startMs  interval start, absolute (UTC epoch ms)
 * @param endMs    interval end, absolute
 * @param tzOffsetMinutes  the zone whose "local time" applies — where the crew
 *   member actually is, not where the operator is based
 */
export function containsLocalNight(
  startMs: number,
  endMs: number,
  tzOffsetMinutes: number,
): boolean {
  if (!(endMs > startMs)) return false
  if (endMs - startMs < LOCAL_NIGHT_DURATION_MIN * MIN_MS) return false

  // Work in local time by shifting the instants, so "local midnight" is a whole
  // number of days.
  const localStart = startMs + tzOffsetMinutes * MIN_MS
  const localEnd = endMs + tzOffsetMinutes * MIN_MS

  // Each candidate window opens at 2200 on some local day. Start one day before
  // the interval so a window opened the previous evening is considered.
  const firstDay = Math.floor(localStart / DAY_MS) - 1
  const lastDay = Math.floor(localEnd / DAY_MS)

  for (let day = firstDay; day <= lastDay; day++) {
    const windowStart = day * DAY_MS + LOCAL_NIGHT_WINDOW_START_MIN * MIN_MS
    const windowEnd = day * DAY_MS + LOCAL_NIGHT_WINDOW_END_MIN * MIN_MS
    const overlap =
      Math.min(localEnd, windowEnd) - Math.max(localStart, windowStart)
    if (overlap >= LOCAL_NIGHT_DURATION_MIN * MIN_MS) return true
  }
  return false
}

/**
 * The earliest instant at which a rest period beginning at `startMs` will
 * CONTAIN a local night.
 *
 * `containsLocalNight` answers the question for a rest period already fixed at
 * both ends. This answers it forwards, which is what "when am I legal" needs:
 * whether the rest includes a local night is a property of the period as
 * actually PROVIDED, and it grows as the crew member waits.
 *
 * That distinction is the whole reason this exists. Testing for a local night
 * once, over a hypothetical 10-hour rest, and falling to 12 hours when it fails
 * misses every case in between — rest that starts in the evening reaches its
 * eighth hour inside the 2200–0800 window somewhere around the eleventh hour of
 * rest, and para 3(1)(a) then asks for only 10. Reporting 12 hours there keeps
 * a legally rested pilot on the ground.
 *
 * @returns the instant, or null if no window in the next few days can hold a
 *   full eight hours from this start (which cannot happen in practice).
 */
export function earliestLocalNightCompletion(
  startMs: number,
  tzOffsetMinutes: number,
): number | null {
  const localStart = startMs + tzOffsetMinutes * MIN_MS
  const firstDay = Math.floor(localStart / DAY_MS) - 1

  let best = Infinity
  for (let day = firstDay; day <= firstDay + 3; day++) {
    const windowStart = day * DAY_MS + LOCAL_NIGHT_WINDOW_START_MIN * MIN_MS
    const windowEnd = day * DAY_MS + LOCAL_NIGHT_WINDOW_END_MIN * MIN_MS
    // The night can only start once the rest has.
    const from = Math.max(localStart, windowStart)
    const completesAt = from + LOCAL_NIGHT_DURATION_MIN * MIN_MS
    // A window entered too late cannot hold eight hours before 0800.
    if (completesAt > windowEnd) continue
    if (completesAt < best) best = completesAt
  }

  return best === Infinity ? null : best - tzOffsetMinutes * MIN_MS
}

/* ── Rest period ─────────────────────────────────────────────────────────── */

/**
 * A "**rest period**" … commences —
 *   (a) **one hour after** that individual is free of all duties, when the rest
 *       is subsequent to a duty period; or
 *   (b) when the individual is away from base, at the time the individual
 *       reaches the accommodation designated for the rest period or one hour
 *       after that individual is free of all duties, **whichever results in a
 *       shorter duration**.
 *
 * (b) can only ever shorten the rest, and the app does not know when a crew
 * member reached their hotel, so (a) is the model and (b) is noted as the one
 * case where the app may report slightly more rest than was actually had.
 */
export const REST_STARTS_AFTER_DUTY_MIN = 60

/* ── Duty period boundaries ─────────────────────────────────────────────── */

/**
 * A "**duty period**" … starts when a crew member is required to report for or
 * to commence a duty and **ends when that crew member is free from all
 * duties**.
 *
 * Fifth Schedule para 7(2) then fixes the two ends: a minimum of 90 minutes for
 * pre-flight and post-flight checks together, of which a minimum of one hour is
 * for the pre-flight checks. So the duty starts an hour before gate-out and
 * ends 30 minutes after gate-in — the post-flight checks are duty, because the
 * crew member is not yet free of all duties while doing them.
 */
export const PRE_FLIGHT_CHECK_MIN = 60
export const POST_FLIGHT_CHECK_MIN = 30

/* ── Circadian definitions ──────────────────────────────────────────────── */

/**
 * "**Early start**", in relation to a duty period, means a scheduled departure
 * that commences in the period 0500 to 0659 hours acclimated time.
 */
export function isEarlyStart(localMinutesOfDay: number): boolean {
  const m = normaliseMinuteOfDay(localMinutesOfDay)
  return m >= 5 * 60 && m <= 6 * 60 + 59
}

/**
 * "**Late finish**", in relation to a duty period, means a scheduled arrival
 * that ends in the period 0100 to 0159 hours acclimated time.
 */
export function isLateFinish(localMinutesOfDay: number): boolean {
  const m = normaliseMinuteOfDay(localMinutesOfDay)
  return m >= 1 * 60 && m <= 1 * 60 + 59
}

/**
 * "**Window of circadian low**", in relation to a take-off or landing, means
 * the period 0200 to 0459 hours acclimated time.
 *
 * Note it is defined only in relation to a TAKE-OFF or LANDING — not to a duty
 * period as a whole, and not to the cruise.
 */
export function isInWindowOfCircadianLow(localMinutesOfDay: number): boolean {
  const m = normaliseMinuteOfDay(localMinutesOfDay)
  return m >= 2 * 60 && m <= 4 * 60 + 59
}

function normaliseMinuteOfDay(minutes: number): number {
  return ((minutes % 1440) + 1440) % 1440
}

/** The minute of the local day an absolute instant falls on, in a given zone. */
export function localMinuteOfDay(atMs: number, tzOffsetMinutes: number): number {
  const local = atMs + tzOffsetMinutes * MIN_MS
  return Math.floor((((local % DAY_MS) + DAY_MS) % DAY_MS) / MIN_MS)
}

/* ── Acclimatisation ────────────────────────────────────────────────────── */

/**
 * "**Acclimated**" means the state of being a crew member who has spent at
 * least 3 consecutive local nights free of duty within a particular time zone.
 *
 * "**Acclimated time**", in relation to a crew member, means the local time in
 * the time zone to which the crew member is acclimated.
 *
 * This is a STATE built from history, not a property of the airport a duty
 * happens to start at. The old code asked "is this departure within 2 hours of
 * Singapore" — which is the right question asked of the wrong thing: para
 * 14(1)(a) compares the local time where the FDP commences against the crew
 * member's ACCLIMATED time, and the acclimated time only moves once they have
 * had three consecutive local nights free of duty somewhere.
 */
export const NIGHTS_TO_ACCLIMATISE = 3

export interface DutyInterval {
  /** Absolute start of the duty period. */
  startMs: number
  /** Absolute end of the duty period. */
  endMs: number
  /** Zone the crew member is in once this duty ends, in minutes from UTC. */
  endZoneOffsetMinutes: number
}

/**
 * The zone a crew member is acclimated to, as an offset in minutes from UTC.
 *
 * Walks the duty history forward. After each duty the crew member is in that
 * duty's arrival zone; if the gap before the next duty contains three
 * consecutive local nights in that zone, they become acclimated to it.
 * Otherwise the previous acclimatisation stands — which is exactly the case
 * the schedule's Table B exists for.
 *
 * @param duties sorted oldest first
 * @param homeOffsetMinutes where the crew member is acclimated to begin with
 * @param nowMs evaluate the state as at this instant
 */
export function acclimatisedOffsetMinutes(
  duties: DutyInterval[],
  homeOffsetMinutes: number,
  nowMs: number,
): number {
  let acclimatised = homeOffsetMinutes

  for (let i = 0; i < duties.length; i++) {
    const duty = duties[i]
    if (duty.startMs > nowMs) break

    // The window free of duty after this one: until the next duty starts, or
    // until now if this is the last.
    const next = duties[i + 1]
    const freeFrom = duty.endMs
    const freeUntil = Math.min(next ? next.startMs : nowMs, nowMs)
    if (freeUntil <= freeFrom) continue

    if (
      countsConsecutiveLocalNights(freeFrom, freeUntil, duty.endZoneOffsetMinutes) >=
      NIGHTS_TO_ACCLIMATISE
    ) {
      acclimatised = duty.endZoneOffsetMinutes
    }
  }

  return acclimatised
}

/**
 * How many CONSECUTIVE local nights an uninterrupted duty-free interval
 * contains, in a given zone.
 *
 * Consecutive falls out of the interval being contiguous: each successive
 * 2200→0800 window that is covered for a full eight hours is the next night.
 */
export function countsConsecutiveLocalNights(
  startMs: number,
  endMs: number,
  tzOffsetMinutes: number,
): number {
  if (!(endMs > startMs)) return 0

  const localStart = startMs + tzOffsetMinutes * MIN_MS
  const localEnd = endMs + tzOffsetMinutes * MIN_MS

  let best = 0
  let run = 0
  const firstDay = Math.floor(localStart / DAY_MS) - 1
  const lastDay = Math.floor(localEnd / DAY_MS)

  for (let day = firstDay; day <= lastDay; day++) {
    const windowStart = day * DAY_MS + LOCAL_NIGHT_WINDOW_START_MIN * MIN_MS
    const windowEnd = day * DAY_MS + LOCAL_NIGHT_WINDOW_END_MIN * MIN_MS
    const overlap = Math.min(localEnd, windowEnd) - Math.max(localStart, windowStart)
    if (overlap >= LOCAL_NIGHT_DURATION_MIN * MIN_MS) {
      run += 1
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  return best
}

/**
 * Para 14(1)(a): Table A applies where the time difference between the crew
 * member's acclimated time and the local time at the place of commencement of
 * the FDP "does not exceed 2 hours".
 */
export const MAX_ACCLIMATION_DIFF_MIN = 2 * 60

export function withinAcclimatisedWindow(
  acclimatisedOffsetMin: number,
  departureOffsetMin: number,
): boolean {
  return Math.abs(departureOffsetMin - acclimatisedOffsetMin) <= MAX_ACCLIMATION_DIFF_MIN
}


/* ── Paragraph 4: duty with take-off or landing within the WOCL ──────────── */

/**
 * Classify a duty against the three circadian definitions, in ACCLIMATED time.
 *
 * All three are defined in the First Schedule in terms of the crew member's
 * acclimated time — not UTC, not the departure station's local time, and not
 * home base. A 0530 departure is an early start for a crew member acclimated
 * to that zone and an ordinary mid-morning departure for one who is not.
 */
export function classifyCircadian(
  {
    departureMs,
    arrivalMs,
    takeoffLandingMs = [],
  }: {
    departureMs?: number
    arrivalMs?: number
    takeoffLandingMs?: number[]
  },
  acclimatedOffsetMinutes: number,
): {
  earlyStart: boolean
  lateFinish: boolean
  woclOperation: boolean
  disruptive: boolean
} {
  const earlyStart =
    departureMs !== undefined &&
    isEarlyStart(localMinuteOfDay(departureMs, acclimatedOffsetMinutes))

  const lateFinish =
    arrivalMs !== undefined &&
    isLateFinish(localMinuteOfDay(arrivalMs, acclimatedOffsetMinutes))

  const woclOperation = takeoffLandingMs.some((at) =>
    isInWindowOfCircadianLow(localMinuteOfDay(at, acclimatedOffsetMinutes)),
  )

  return {
    earlyStart,
    lateFinish,
    woclOperation,
    disruptive: earlyStart || lateFinish || woclOperation,
  }
}

/**
 * Paragraph 4 requires a rest period of **24 hours inclusive of a local night**
 * in two situations:
 *
 *   4(1)(a) — before the FIRST flight duty period in a series that encompasses
 *     an early start, a late finish, or a take-off or landing in the window of
 *     circadian low; and
 *   4(2) — where a crew member completes 2 consecutive such flight duty
 *     periods, before the NEXT one.
 *
 * @param priorDisruptiveRun how many consecutive disruptive FDPs immediately
 *   precede this one
 * @param thisIsDisruptive whether this FDP is itself disruptive
 */
export const CIRCADIAN_REST_MIN = 24 * 60

export function circadianRestRule(
  priorDisruptiveRun: number,
  thisIsDisruptive: boolean,
): "4a" | "4b" | null {
  if (!thisIsDisruptive) return null
  // Two consecutive disruptive duties already completed — 4(2) bites before the
  // next one.
  if (priorDisruptiveRun >= 2) return "4b"
  // The first of a series — 4(1)(a).
  if (priorDisruptiveRun === 0) return "4a"
  return null
}
