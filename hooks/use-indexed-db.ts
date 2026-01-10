"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import {
  initializeDB,
  getAllFlights,
  getAllAircraft,
  getAllAirports,
  getAllPersonnel,
  getFlightStats,
  bulkLoadAirports,
  getAirportDatabase,
  type FlightLog,
  type Aircraft,
  type Airport,
  type Personnel,
} from "@/lib/db";

// Keys for SWR cache
export const CACHE_KEYS = {
  flights: "idb:flights",
  aircraft: "idb:aircraft",
  airports: "idb:airports",
  personnel: "idb:personnel",
  stats: "idb:stats",
  dbReady: "idb:ready",
};

let dbInitialized = false;
let dbInitPromise: Promise<boolean> | null = null;

// Initialize DB and return ready state
async function checkDBReady(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (dbInitialized) return true;

  if (!dbInitPromise) {
    dbInitPromise = initializeDB().then((ready) => {
      dbInitialized = ready;
      return ready;
    });
  }

  return dbInitPromise;
}

async function fetchFlights(): Promise<FlightLog[]> {
  const ready = await checkDBReady();
  if (!ready) return [];
  const flights = await getAllFlights();
  console.log("[v0] Fetched flights from IndexedDB:", flights.length);
  return flights;
}

async function fetchAircraft(): Promise<Aircraft[]> {
  const ready = await checkDBReady();
  if (!ready) return [];
  const aircraft = await getAllAircraft();
  console.log("[v0] Fetched aircraft from IndexedDB:", aircraft.length);
  return aircraft;
}

// Inside @/hooks/use-indexed-db.ts

async function fetchAirports(): Promise<Airport[]> {
  const ready = await checkDBReady();
  if (!ready) return [];

  // 1. Try to get data from IndexedDB
  let airports = await getAllAirports();

  // 2. If DB is empty, fetch the JSON and seed it
  if (airports.length === 0) {
    console.log("[v0] DB empty, fetching airports.min.json...");
    const data = await getAirportDatabase(); // This performs the fetch('/airports.min.json')

    // 3. Save to IndexedDB so next time it's instant
    await bulkLoadAirports(data);

    // 4. Retrieve the newly saved records
    airports = await getAllAirports();
  }

  console.log("[v0] Total airports loaded:", airports.length);
  return airports;
}

async function fetchPersonnel(): Promise<Personnel[]> {
  const ready = await checkDBReady();
  if (!ready) return [];
  const personnel = await getAllPersonnel();
  console.log("[v0] Fetched personnel from IndexedDB:", personnel.length);
  return personnel;
}

async function fetchStats() {
  const ready = await checkDBReady();
  if (!ready) {
    return {
      totalFlights: 0,
      blockTime: "00:00",
      flightTime: "00:00",
      p1Time: "00:00",
      p2Time: "00:00",
      p1usTime: "00:00",
      dualTime: "00:00",
      nightTime: "00:00",
      ifrTime: "00:00",
      totalDayLandings: 0,
      totalNightLandings: 0,
      uniqueAircraft: 0,
      uniqueAirports: 0,
    };
  }
  return getFlightStats();
}

// Hook for DB ready state
export function useDBReady() {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkDBReady().then((ready) => {
      setIsReady(ready);
      setIsLoading(false);
    });
  }, []);

  return { isReady, isLoading };
}

export function useFlights() {
  const { isReady } = useDBReady();

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateFlights,
  } = useSWR(isReady ? CACHE_KEYS.flights : null, fetchFlights, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0, // Always fetch fresh
  });

  const refresh = useCallback(() => {
    console.log("[v0] Refreshing flights...");
    return mutateFlights(undefined, { revalidate: true });
  }, [mutateFlights]);

  return {
    flights: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  };
}

export function useAircraft() {
  const { isReady } = useDBReady();

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateAircraft,
  } = useSWR(isReady ? CACHE_KEYS.aircraft : null, fetchAircraft, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  });

  const refresh = useCallback(() => {
    console.log("[v0] Refreshing aircraft...");
    return mutateAircraft(undefined, { revalidate: true });
  }, [mutateAircraft]);

  return {
    aircraft: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  };
}

export function useAirports() {
  const { isReady } = useDBReady();

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateAirports,
  } = useSWR(isReady ? CACHE_KEYS.airports : null, fetchAirports, {
    revalidateOnFocus: false,
    revalidateOnMount: false,
    dedupingInterval: 10000,
  });

  const refresh = useCallback(() => {
    console.log("[v0] Refreshing airports...");

    return mutateAirports(undefined, { revalidate: true });
  }, [mutateAirports]);

  return {
    airports: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  };
}

export function usePersonnel() {
  const { isReady } = useDBReady();

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutatePersonnel,
  } = useSWR(isReady ? CACHE_KEYS.personnel : null, fetchPersonnel, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  });

  const refresh = useCallback(() => {
    console.log("[v0] Refreshing personnel...");
    return mutatePersonnel(undefined, { revalidate: true });
  }, [mutatePersonnel]);

  return {
    personnel: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  };
}

// Hook for stats
export function useFlightStats() {
  const { isReady } = useDBReady();

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateStats,
  } = useSWR(isReady ? CACHE_KEYS.stats : null, fetchStats, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  });

  const refresh = useCallback(() => {
    return mutateStats(undefined, { revalidate: true });
  }, [mutateStats]);

  return {
    stats: data ?? {
      totalFlights: 0,
      blockTime: "00:00",
      flightTime: "00:00",
      p1Time: "00:00",
      p2Time: "00:00",
      p1usTime: "00:00",
      dualTime: "00:00",
      nightTime: "00:00",
      ifrTime: "00:00",
      totalDayLandings: 0,
      totalNightLandings: 0,
      uniqueAircraft: 0,
      uniqueAirports: 0,
    },
    isLoading: isLoading || isValidating,
    error,
    refresh,
  };
}

export function useAirportDatabase() {
  // We use the Airport type defined in lib/indexed-db
  const [airports, setAirports] = useState<Airport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setIsLoading(true);
        // This function now handles the local fetch + Dexie caching logic
        const data = await getAirportDatabase();

        if (mounted) {
          // 'data' is already formatted as Airport[] from our previous steps
          setAirports(data as unknown as Airport[]);
          console.log(
            "[Airport DB] Database ready with",
            data.length,
            "records"
          );
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
          console.error("[Airport DB] Load failed:", err);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  return { airports, isLoading, error };
}

export async function refreshAllData() {
  console.log("[v0] Refreshing all data from IndexedDB...");
  await Promise.all([
    mutate(CACHE_KEYS.flights, undefined, { revalidate: true }),
    mutate(CACHE_KEYS.aircraft, undefined, { revalidate: true }),
    mutate(CACHE_KEYS.personnel, undefined, { revalidate: true }),
    mutate(CACHE_KEYS.stats, undefined, { revalidate: true }),
  ]);
  console.log("[v0] All data refreshed");
}
