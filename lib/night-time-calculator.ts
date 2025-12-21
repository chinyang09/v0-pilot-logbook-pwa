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

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

// ============================================
// Haversine / Great Circle Calculations
// ============================================

/**
  
  - Calculate great circle distance between two points using Haversine formula
  - Returns distance in nautical miles
    */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3440.065; // Earth’s radius in nautical miles

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

/**
  
  - Interpolate position along great circle path
  - fraction: 0 = start point, 1 = end point
  - Returns [latitude, longitude]
    */
export function interpolateGreatCircle(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  fraction: number
): [number, number] {
  // Handle same point case
  if (lat1 === lat2 && lon1 === lon2) {
    return [lat1, lon1];
  }

  const φ1 = toRadians(lat1);
  const λ1 = toRadians(lon1);
  const φ2 = toRadians(lat2);
  const λ2 = toRadians(lon2);

  // Calculate angular distance
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.pow(Math.sin((φ2 - φ1) / 2), 2) +
          Math.cos(φ1) * Math.cos(φ2) * Math.pow(Math.sin((λ2 - λ1) / 2), 2)
      )
    );

  // Handle very short distances (avoid division by zero)
  if (d < 0.0001) {
    return [lat1 + fraction * (lat2 - lat1), lon1 + fraction * (lon2 - lon1)];
  }

  const a = Math.sin((1 - fraction) * d) / Math.sin(d);
  const b = Math.sin(fraction * d) / Math.sin(d);

  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
  const z = a * Math.sin(φ1) + b * Math.sin(φ2);

  const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
  const λ = Math.atan2(y, x);

  return [toDegrees(φ), toDegrees(λ)];
}

// ============================================
// NOAA Solar Position Calculator
// ============================================

/**
  
  - Calculate solar elevation angle using NOAA algorithm
  - Returns elevation in degrees (positive above horizon, negative below)
    */
function calculateSolarElevation(date: Date, lat: number, lon: number): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;

  // Mean longitude of sun
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;

  // Mean anomaly of sun
  const M = (357.52911 + jc * (35999.05029 - 0.0001537 * jc)) % 360;

  // Sun equation of center
  const C =
    Math.sin(toRadians(M)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(toRadians(2 * M)) * (0.019993 - 0.000101 * jc) +
    Math.sin(toRadians(3 * M)) * 0.000289;

  // True longitude
  const sunTrueLon = L0 + C;

  // Apparent longitude
  const omega = 125.04 - 1934.136 * jc;
  const lambda = sunTrueLon - 0.00569 - 0.00478 * Math.sin(toRadians(omega));

  // Obliquity of ecliptic
  const epsilon =
    23.439291 - jc * (0.0130042 + jc * (0.00000016 - jc * 0.000000504));

  // Sun declination
  const declination = toDegrees(
    Math.asin(Math.sin(toRadians(epsilon)) * Math.sin(toRadians(lambda)))
  );

  // Equation of time
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

  // Hour angle
  const timeOffset = eqTime + 4 * lon;
  const trueSolarTime =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    timeOffset;
  const hourAngle = trueSolarTime / 4 - 180;

  // Solar elevation angle
  const sinElevation =
    Math.sin(toRadians(lat)) * Math.sin(toRadians(declination)) +
    Math.cos(toRadians(lat)) *
      Math.cos(toRadians(declination)) *
      Math.cos(toRadians(hourAngle));

  const elevation = toDegrees(Math.asin(sinElevation));

  // Apply atmospheric refraction correction
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

/**
  
  - Determine if it’s night based on civil twilight
  - Night = sun more than 6 degrees below horizon
    */
function isNightFromElevation(elevation: number): boolean {
  return elevation < -6; // Civil twilight threshold
}

/**
  
  - Check if a given UTC time at a specific location is during night
  - Uses solar elevation calculation
    */
export function isNight(
  dateTime: Date,
  latitude: number,
  longitude: number
): boolean {
  if (isNaN(dateTime.getTime()) || isNaN(latitude) || isNaN(longitude)) {
    return false;
  }

  const elevation = calculateSolarElevation(dateTime, latitude, longitude);
  return isNightFromElevation(elevation);
}

/**
  
  - Overload for string date/time inputs
    */
export function isNightFromStrings(
  dateStr: string,
  timeStr: string,
  latitude: number,
  longitude: number
): boolean {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const [year, month, day] = dateStr.split("-").map(Number);

  if (
    isNaN(hours) ||
    isNaN(minutes) ||
    isNaN(year) ||
    isNaN(month) ||
    isNaN(day)
  ) {
    return false;
  }

  const dateTime = new Date(
    Date.UTC(year, month - 1, day, hours, minutes, 0, 0)
  );
  return isNight(dateTime, latitude, longitude);
}

// ============================================
// 3-Phase Night Time Calculation
// ============================================

interface NightTimeResult {
  phase1NightMinutes: number; // OUT to OFF (on ground at departure)
  phase2NightMinutes: number; // OFF to ON (in flight)
  phase3NightMinutes: number; // ON to IN (on ground at arrival)
  totalNightMinutes: number;
  totalBlockMinutes: number;
  nightTimeHHMM: string;
  dayTimeHHMM: string;
}

/**
  
  - Calculate night time for a single phase at a fixed location
  - Samples every minute for accuracy
    */
function calculatePhaseNightTime(
  startTime: Date,
  endTime: Date,
  latitude: number,
  longitude: number
): number {
  if (startTime >= endTime) return 0;

  const durationMinutes = Math.round(
    (endTime.getTime() - startTime.getTime()) / (1000 * 60)
  );
  if (durationMinutes <= 0) return 0;

  let nightMinutes = 0;

  // Sample every minute for accuracy
  for (let i = 0; i < durationMinutes; i++) {
    const sampleTime = new Date(startTime.getTime() + i * 60 * 1000);
    if (isNight(sampleTime, latitude, longitude)) {
      nightMinutes += 1;
    }
  }

  return nightMinutes;
}

/**
  
  - Calculate night time for in-flight phase using great circle interpolation
  - Samples position every minute along the great circle route
    */
function calculateInFlightNightTime(
  offTime: Date,
  onTime: Date,
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number
): number {
  if (offTime >= onTime) return 0;

  const durationMinutes = Math.round(
    (onTime.getTime() - offTime.getTime()) / (1000 * 60)
  );
  if (durationMinutes <= 0) return 0;

  let nightMinutes = 0;

  // Sample every minute along the great circle
  for (let i = 0; i < durationMinutes; i++) {
    const fraction = durationMinutes > 1 ? i / (durationMinutes - 1) : 0;
    const sampleTime = new Date(offTime.getTime() + i * 60 * 1000);
    // Interpolate position along great circle
    const [lat, lon] = interpolateGreatCircle(
      depLat,
      depLon,
      arrLat,
      arrLon,
      fraction
    );

    if (isNight(sampleTime, lat, lon)) {
      nightMinutes += 1;
    }
  }

  return nightMinutes;
}

/**
  
  - Parse time string (HH:MM) and date string (YYYY-MM-DD) to UTC Date
  - Handles overnight flights by incrementing day when times wrap
    */
function parseTimeToUTC(
  dateStr: string,
  timeStr: string,
  prevTime?: Date
): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);

  if (
    isNaN(year) ||
    isNaN(month) ||
    isNaN(day) ||
    isNaN(hours) ||
    isNaN(minutes)
  ) {
    return new Date(Number.NaN);
  }

  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));

  // Handle overnight: if this time is before the previous time, add a day
  if (prevTime && date <= prevTime) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date;
}

/**
  
  - Format minutes to HH:MM string
    */
function minutesToHHMM(minutes: number): string {
  if (isNaN(minutes) || minutes < 0) return "00:00";
  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return `${hours.toString().padStart(2, "0")}:${mins
    .toString()
    .padStart(2, "0")}`;
}

/**
  
  - Calculate complete night time breakdown for a flight
  - 
  - Inputs:
  - - date: Flight date (YYYY-MM-DD)
  - - outTime, offTime, onTime, inTime: OOOI times in HH:MM UTC
  - - depLat, depLon: Departure airport coordinates
  - - arrLat, arrLon: Arrival airport coordinates
  - 
  - Returns:
  - - Night time breakdown by phase
  - - Total night time and day time in HH:MM format
      */
export function calculateNightTimeComplete(
  date: string,
  outTime: string,
  offTime: string,
  onTime: string,
  inTime: string,
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number
): NightTimeResult {
  // Validate inputs
  if (!date || !outTime || !offTime || !onTime || !inTime) {
    return {
      phase1NightMinutes: 0,
      phase2NightMinutes: 0,
      phase3NightMinutes: 0,
      totalNightMinutes: 0,
      totalBlockMinutes: 0,
      nightTimeHHMM: "00:00",
      dayTimeHHMM: "00:00",
    };
  }

  if (isNaN(depLat) || isNaN(depLon) || isNaN(arrLat) || isNaN(arrLon)) {
    return {
      phase1NightMinutes: 0,
      phase2NightMinutes: 0,
      phase3NightMinutes: 0,
      totalNightMinutes: 0,
      totalBlockMinutes: 0,
      nightTimeHHMM: "00:00",
      dayTimeHHMM: "00:00",
    };
  }

  // Parse all times, handling overnight flights
  const outUTC = parseTimeToUTC(date, outTime);
  const offUTC = parseTimeToUTC(date, offTime, outUTC);
  const onUTC = parseTimeToUTC(date, onTime, offUTC);
  const inUTC = parseTimeToUTC(date, inTime, onUTC);

  // Validate parsed times
  if (
    isNaN(outUTC.getTime()) ||
    isNaN(offUTC.getTime()) ||
    isNaN(onUTC.getTime()) ||
    isNaN(inUTC.getTime())
  ) {
    return {
      phase1NightMinutes: 0,
      phase2NightMinutes: 0,
      phase3NightMinutes: 0,
      totalNightMinutes: 0,
      totalBlockMinutes: 0,
      nightTimeHHMM: "00:00",
      dayTimeHHMM: "00:00",
    };
  }

  // Calculate total block time
  const totalBlockMinutes = Math.round(
    (inUTC.getTime() - outUTC.getTime()) / (1000 * 60)
  );

  // Phase 1: OUT to OFF (on ground at departure)
  const phase1NightMinutes = calculatePhaseNightTime(
    outUTC,
    offUTC,
    depLat,
    depLon
  );

  // Phase 2: OFF to ON (in flight along great circle)
  const phase2NightMinutes = calculateInFlightNightTime(
    offUTC,
    onUTC,
    depLat,
    depLon,
    arrLat,
    arrLon
  );

  // Phase 3: ON to IN (on ground at arrival)
  const phase3NightMinutes = calculatePhaseNightTime(
    onUTC,
    inUTC,
    arrLat,
    arrLon
  );

  // Total night time
  const totalNightMinutes =
    phase1NightMinutes + phase2NightMinutes + phase3NightMinutes;

  // Day time = block time - night time
  const dayMinutes = Math.max(0, totalBlockMinutes - totalNightMinutes);

  return {
    phase1NightMinutes,
    phase2NightMinutes,
    phase3NightMinutes,
    totalNightMinutes,
    totalBlockMinutes,
    nightTimeHHMM: minutesToHHMM(totalNightMinutes),
    dayTimeHHMM: minutesToHHMM(dayMinutes),
  };
}

/**
  
  - Simplified interface for flight form - returns just night time in HH:MM
    */
export function calculateNightTime(
  date: string,
  outTime: string,
  offTime: string,
  onTime: string,
  inTime: string,
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number
): string {
  const result = calculateNightTimeComplete(
    date,
    outTime,
    offTime,
    onTime,
    inTime,
    depLat,
    depLon,
    arrLat,
    arrLon
  );
  return result.nightTimeHHMM;
}

/**
  
  - Legacy function for calculating block/flight times from OOOI
  - Kept for backwards compatibility
    */
export function calculateTimesFromOOOI(
  outTime: string,
  offTime: string,
  onTime: string,
  inTime: string,
  date: string
): { blockTime: string; flightTime: string } {
  // Parse times
  const outUTC = parseTimeToUTC(date, outTime);
  const offUTC = parseTimeToUTC(date, offTime, outUTC);
  const onUTC = parseTimeToUTC(date, onTime, offUTC);
  const inUTC = parseTimeToUTC(date, inTime, onUTC);

  if (isNaN(outUTC.getTime()) || isNaN(inUTC.getTime())) {
    return { blockTime: "00:00", flightTime: "00:00" };
  }

  const blockMinutes = Math.round(
    (inUTC.getTime() - outUTC.getTime()) / (1000 * 60)
  );
  const flightMinutes = Math.round(
    (onUTC.getTime() - offUTC.getTime()) / (1000 * 60)
  );

  return {
    blockTime: minutesToHHMM(Math.max(0, blockMinutes)),
    flightTime: minutesToHHMM(Math.max(0, flightMinutes)),
  };
}
