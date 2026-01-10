/**

- Night Time Calculator
- 
- Calculates night flying time based on NOAA solar position algorithms
- Uses civil twilight (sun 6 degrees below horizon) as per aviation standards
- 
- Night time is calculated in 3 phases:
- Phase 1: OUT to OFF time (on ground at departure airport)
- Phase 2: OFF to ON time (in flight, using great circle interpolation)
- Phase 3: ON to IN time (on ground at arrival airport)
  */

// ============================================
// Math Utilities
// ============================================

// ============================================
// Types
// ============================================

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface NightTimeResult {
  phase1NightMinutes: number;
  phase2NightMinutes: number;
  phase3NightMinutes: number;
  totalNightMinutes: number;
  totalBlockMinutes: number;
  nightTimeHHMM: string;
  dayTimeHHMM: string;
}

// ============================================
// Math & NOAA Utilities (Collapsed for brevity)
// ============================================

function toRadians(d: number) {
  return d * (Math.PI / 180);
}
function toDegrees(r: number) {
  return r * (180 / Math.PI);
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3440.065;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function interpolateGreatCircle(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  fraction: number
): [number, number] {
  if (lat1 === lat2 && lon1 === lon2) return [lat1, lon1];
  const φ1 = toRadians(lat1);
  const λ1 = toRadians(lon1);
  const φ2 = toRadians(lat2);
  const λ2 = toRadians(lon2);
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.pow(Math.sin((φ2 - φ1) / 2), 2) +
          Math.cos(φ1) * Math.cos(φ2) * Math.pow(Math.sin((λ2 - λ1) / 2), 2)
      )
    );
  if (d < 0.0001)
    return [lat1 + fraction * (lat2 - lat1), lon1 + fraction * (lon2 - lon1)];
  const a = Math.sin((1 - fraction) * d) / Math.sin(d);
  const b = Math.sin(fraction * d) / Math.sin(d);
  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
  const z = a * Math.sin(φ1) + b * Math.sin(φ2);
  const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
  const λ = Math.atan2(y, x);
  return [toDegrees(φ), toDegrees(λ)];
}

// ... (Keep NOAA Solar Position Calculator functions exactly as they are) ...

function calculateSolarElevation(date: Date, lat: number, lon: number): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const M = (357.52911 + jc * (35999.05029 - 0.0001537 * jc)) % 360;
  const C =
    Math.sin(toRadians(M)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(toRadians(2 * M)) * (0.019993 - 0.000101 * jc) +
    Math.sin(toRadians(3 * M)) * 0.000289;
  const sunTrueLon = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const lambda = sunTrueLon - 0.00569 - 0.00478 * Math.sin(toRadians(omega));
  const epsilon =
    23.439291 - jc * (0.0130042 + jc * (0.00000016 - jc * 0.000000504));
  const declination = toDegrees(
    Math.asin(Math.sin(toRadians(epsilon)) * Math.sin(toRadians(lambda)))
  );
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const y = Math.tan(toRadians(epsilon / 2)) * Math.tan(toRadians(epsilon / 2));
  const eqTime =
    4 *
    toDegrees(
      y * Math.sin(2 * toRadians(L0)) -
        2 * e * Math.sin(toRadians(M)) +
        4 * e * y * Math.sin(toRadians(M)) * Math.cos(2 * toRadians(L0)) -
        0.5 * y * y * Math.sin(4 * toRadians(L0)) -
        1.25 * e * e * Math.sin(2 * toRadians(M))
    );
  const timeOffset = eqTime + 4 * lon;
  const trueSolarTime =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    timeOffset;
  const hourAngle = trueSolarTime / 4 - 180;
  const sinElevation =
    Math.sin(toRadians(lat)) * Math.sin(toRadians(declination)) +
    Math.cos(toRadians(lat)) *
      Math.cos(toRadians(declination)) *
      Math.cos(toRadians(hourAngle));
  const elevation = toDegrees(Math.asin(sinElevation));
  let refraction = 0;
  if (elevation > 85) {
    refraction = 0;
  } else if (elevation > 5) {
    refraction =
      58.1 / Math.tan(toRadians(elevation)) -
      0.07 / Math.pow(Math.tan(toRadians(elevation)), 3) +
      0.000086 / Math.pow(Math.tan(toRadians(elevation)), 5);
  } else if (elevation > -0.575) {
    refraction =
      1735 +
      elevation *
        (-518.2 +
          elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  } else {
    refraction = -20.772 / Math.tan(toRadians(elevation));
  }
  refraction = refraction / 3600;
  return elevation + refraction;
}

export function isNight(date: Date, lat: number, lon: number): boolean {
  // Simple guard clause
  if (isNaN(date.getTime()) || isNaN(lat) || isNaN(lon)) return false;

  // Uses -6 degrees (Civil Twilight)
  return calculateSolarElevation(date, lat, lon) < -6;
}

// ============================================
// Core Logic
// ============================================

/**
 * Handles overnight date wrapping.
 * LOGIC FIX: Strictly adds a day only if time decreases (20:00 -> 00:40).
 * If time is same (20:00 -> 20:00), it assumes same day.
 */
function parseTimeToUTC(
  dateStr: string,
  timeStr: string,
  prevTime?: Date
): Date {
  if (!timeStr) return new Date(NaN);

  const [y, m, d] = dateStr.split("-").map(Number);
  const [hours, mins] = timeStr.split(":").map(Number);

  if ([y, m, d, hours, mins].some(isNaN)) return new Date(NaN);

  const date = new Date(Date.UTC(y, m - 1, d, hours, mins, 0, 0));

  // strict less than (<) prevents the 24h bug
  if (prevTime && date < prevTime) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date;
}

function calculateDurationMinutes(start: Date, end: Date): number {
  if (start >= end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function calculatePathNightMinutes(
  start: Date,
  end: Date,
  startCoord: GeoPoint,
  endCoord: GeoPoint,
  interpolate: boolean
): number {
  const duration = calculateDurationMinutes(start, end);
  if (duration <= 0) return 0;

  let nightMinutes = 0;

  for (let i = 0; i < duration; i++) {
    const sampleTime = new Date(start.getTime() + i * 60000);

    // Determine position for this minute
    let lat = startCoord.lat;
    let lon = startCoord.lon;

    if (interpolate && duration > 1) {
      const fraction = i / (duration - 1);
      const [iLat, iLon] = interpolateGreatCircle(
        startCoord.lat,
        startCoord.lon,
        endCoord.lat,
        endCoord.lon,
        fraction
      );
      lat = iLat;
      lon = iLon;
    }

    if (isNight(sampleTime, lat, lon)) {
      nightMinutes++;
    }
  }

  return nightMinutes;
}

// ============================================
// Main Export
// ============================================

export function calculateNightTimeComplete(
  date: string,
  outTime: string,
  offTime: string,
  onTime: string,
  inTime: string,
  dep: GeoPoint, // REFACTOR: Using objects makes calls safer
  arr: GeoPoint
): NightTimeResult {
  const zeroResult: NightTimeResult = {
    phase1NightMinutes: 0,
    phase2NightMinutes: 0,
    phase3NightMinutes: 0,
    totalNightMinutes: 0,
    totalBlockMinutes: 0,
    nightTimeHHMM: "00:00",
    dayTimeHHMM: "00:00",
  };

  // 1. Fallback Logic (Refactored to allow 00:00)
  // We only fallback if the string is empty or undefined
  const effectiveOff = offTime ? offTime : outTime;
  const effectiveOn = onTime ? onTime : inTime;

  if (!date || !outTime || !inTime || isNaN(dep.lat) || isNaN(arr.lat)) {
    return zeroResult;
  }

  // 2. Parse Times (Midnight wrap logic inside)
  const outUTC = parseTimeToUTC(date, outTime);
  const offUTC = parseTimeToUTC(date, effectiveOff, outUTC);
  const onUTC = parseTimeToUTC(date, effectiveOn, offUTC);
  const inUTC = parseTimeToUTC(date, inTime, onUTC);

  if ([outUTC, offUTC, onUTC, inUTC].some((d) => isNaN(d.getTime()))) {
    return zeroResult;
  }

  // 3. Calculate Phases
  const totalBlockMinutes = calculateDurationMinutes(outUTC, inUTC);

  const phase1 = calculatePathNightMinutes(outUTC, offUTC, dep, dep, false);
  const phase2 = calculatePathNightMinutes(offUTC, onUTC, dep, arr, true);
  const phase3 = calculatePathNightMinutes(onUTC, inUTC, arr, arr, false);

  const totalNight = phase1 + phase2 + phase3;
  const totalDay = Math.max(0, totalBlockMinutes - totalNight);

  const minutesToHHMM = (m: number) => {
    if (isNaN(m) || m < 0) return "00:00";
    const h = Math.floor(m / 60)
      .toString()
      .padStart(2, "0");
    const min = Math.floor(m % 60)
      .toString()
      .padStart(2, "0");
    return `${h}:${min}`;
  };

  return {
    phase1NightMinutes: phase1,
    phase2NightMinutes: phase2,
    phase3NightMinutes: phase3,
    totalNightMinutes: totalNight,
    totalBlockMinutes: totalBlockMinutes,
    nightTimeHHMM: minutesToHHMM(totalNight),
    dayTimeHHMM: minutesToHHMM(totalDay),
  };
}
