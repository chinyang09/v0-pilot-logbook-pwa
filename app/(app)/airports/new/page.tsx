"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/page-container";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { addCustomAirport, updateFlight } from "@/lib/db";
import { syncService } from "@/lib/sync";

// --- Reusable Row (matches crew page pattern) ---
function SettingsRow({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  uppercase = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  uppercase?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      <Input
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
  const [timezone, setTimezone] = useState("");

  const hasValidCode = icao.trim().length > 0 || iata.trim().length > 0;

  const handleSave = async () => {
    if (!hasValidCode) return;

    setIsSaving(true);
    try {
      const icaoCode = icao.trim().toUpperCase() || iata.trim().toUpperCase();

      const newAirport = await addCustomAirport({
        icao: icaoCode,
        iata: iata.trim().toUpperCase(),
        name: name.trim(),
        city: city.trim(),
        state: "",
        country: country.trim().toUpperCase(),
        latitude: 0,
        longitude: 0,
        elevation: 0,
        tz: timezone.trim() || "UTC",
        isCustom: true,
      });

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
            <SettingsRow
              label="Timezone"
              value={timezone}
              onChange={setTimezone}
              placeholder="e.g. Asia/Singapore"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground px-4">
          Enter at least an ICAO or IATA code. Other fields are optional and may
          be auto-populated when the airport is enriched.
        </p>
      </div>
    </PageContainer>
  );
}
