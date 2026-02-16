"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/page-container";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { addCustomAirport, updateFlight } from "@/lib/db";
import { syncService } from "@/lib/sync";
import { submitAirportToServer } from "@/lib/submissions/submit";

// --- Reusable Row (matches crew page pattern) ---
function SettingsRow({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  uppercase = false,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  uppercase?: boolean;
  type?: string;
  inputMode?: "text" | "decimal" | "numeric";
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      <Input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) =>
          onChange?.(uppercase ? e.target.value.toUpperCase() : e.target.value)
        }
        placeholder={placeholder}
        className={`text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[200px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 ${
          uppercase ? "uppercase" : ""
        }`}
      />
    </div>
  );
}

export default function NewAirportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledCode = searchParams.get("code") || "";
  const fieldType = searchParams.get("field");
  const flightId = searchParams.get("flightId");

  const [isSaving, setIsSaving] = useState(false);
  const [icao, setIcao] = useState(
    prefilledCode.length === 4 ? prefilledCode.toUpperCase() : ""
  );
  const [iata, setIata] = useState(
    prefilledCode.length === 3 ? prefilledCode.toUpperCase() : ""
  );
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [elevation, setElevation] = useState("");
  const [timezone, setTimezone] = useState("");
  const [tzLoading, setTzLoading] = useState(false);
  const tzAbortRef = useRef<AbortController | null>(null);

  const hasValidCode = icao.trim().length > 0 || iata.trim().length > 0;

  // Auto-derive timezone from lat/lng via geo-tz API
  useEffect(() => {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    // Abort previous request
    tzAbortRef.current?.abort();
    const controller = new AbortController();
    tzAbortRef.current = controller;

    setTzLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/timezone?lat=${lat}&lng=${lng}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("Timezone lookup failed");
        const data = await res.json();
        if (data.tz) {
          setTimezone(data.tz);
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("[NewAirport] Timezone lookup failed:", err);
        }
      } finally {
        if (!controller.signal.aborted) setTzLoading(false);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [latitude, longitude]);

  const handleSave = async () => {
    if (!hasValidCode) return;

    setIsSaving(true);
    try {
      const icaoCode = icao.trim().toUpperCase() || iata.trim().toUpperCase();
      const lat = parseFloat(latitude) || 0;
      const lng = parseFloat(longitude) || 0;
      const elev = parseFloat(elevation) || 0;

      const newAirport = await addCustomAirport({
        icao: icaoCode,
        iata: iata.trim().toUpperCase(),
        name: name.trim(),
        city: city.trim(),
        state: "",
        country: country.trim().toUpperCase(),
        latitude: lat,
        longitude: lng,
        elevation: elev,
        tz: timezone.trim() || "UTC",
        isCustom: true,
      });

      // Fire-and-forget server submission for enrichment
      if (newAirport.submissionId) {
        submitAirportToServer({
          submissionId: newAirport.submissionId,
          icao: icaoCode,
          name: name.trim(),
          iata: iata.trim().toUpperCase(),
          city: city.trim(),
          country: country.trim().toUpperCase(),
          timezone: timezone.trim(),
          latitude: lat,
          longitude: lng,
          elevation: elev,
        });
      }

      if (fieldType && flightId) {
        const updates: Record<string, string> = {};
        if (fieldType === "departureIcao") {
          updates.departureIcao = icaoCode;
          updates.departureIata = iata.trim().toUpperCase();
        } else if (fieldType === "arrivalIcao") {
          updates.arrivalIcao = icaoCode;
          updates.arrivalIata = iata.trim().toUpperCase();
        }
        await updateFlight(flightId, updates);
        syncService.notifyDataChange();
        router.back();
      } else {
        router.back();
      }
    } catch (error) {
      console.error("Failed to save airport:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <PageContainer
      header={
        <header className="bg-background/30 backdrop-blur-xl border-b border-border/50 z-50">
          <div className="container mx-auto px-3">
            <div className="flex items-center justify-between h-12">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="text-primary h-8 px-2"
              >
                Cancel
              </Button>
              <h1 className="text-lg font-semibold truncate px-2">
                New Airport
              </h1>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                disabled={!hasValidCode || isSaving}
                className="text-primary h-8 px-2 font-semibold"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </header>
      }
    >
      <div className="container mx-auto px-3 pt-4 pb-safe">
        {/* Main Info Card */}
        <div className="bg-card rounded-xl overflow-hidden mb-6 border border-border">
          <div className="px-4">
            <SettingsRow
              label="ICAO Code"
              value={icao}
              onChange={setIcao}
              placeholder="e.g. WSSL"
              uppercase
            />
            <SettingsRow
              label="IATA Code"
              value={iata}
              onChange={setIata}
              placeholder="e.g. XSP"
              uppercase
            />
            <SettingsRow
              label="Name"
              value={name}
              onChange={setName}
              placeholder="Airport name"
            />
            <SettingsRow
              label="City"
              value={city}
              onChange={setCity}
              placeholder="City"
            />
            <SettingsRow
              label="Country"
              value={country}
              onChange={setCountry}
              placeholder="e.g. SG"
              uppercase
            />
          </div>
        </div>

        {/* Location Card */}
        <div className="bg-card rounded-xl overflow-hidden mb-6 border border-border">
          <div className="px-4">
            <SettingsRow
              label="Latitude"
              value={latitude}
              onChange={setLatitude}
              placeholder="e.g. 1.3644"
              inputMode="decimal"
            />
            <SettingsRow
              label="Longitude"
              value={longitude}
              onChange={setLongitude}
              placeholder="e.g. 103.9915"
              inputMode="decimal"
            />
            <SettingsRow
              label="Elevation (ft)"
              value={elevation}
              onChange={setElevation}
              placeholder="e.g. 40"
              inputMode="numeric"
            />
            <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
              <span className="text-foreground">Timezone</span>
              <div className="flex items-center gap-2">
                {tzLoading && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
                <Input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="e.g. Asia/Singapore"
                  className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[200px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
                />
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground px-4">
          Enter at least an ICAO or IATA code. Timezone is auto-derived from
          coordinates when latitude and longitude are provided.
        </p>
      </div>
    </PageContainer>
  );
}
