"use client";

import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Initial check
    setIsOffline(!navigator.onLine);

    const clearHideTimer = () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const handleOnline = () => {
      // Cancel any pending "Back online" auto-hide first — otherwise a quick
      // offline→online→offline flap fires a stale timer that hides the (still
      // valid) offline banner. The returned closure was never invoked (this is
      // an event handler, not an effect), so the old timer leaked.
      clearHideTimer();
      setIsOffline(false);
      setShowBanner(true);
      hideTimerRef.current = setTimeout(() => setShowBanner(false), 3000);
    };

    const handleOffline = () => {
      clearHideTimer();
      setIsOffline(true);
      setShowBanner(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearHideTimer();
    };
  }, []);

  if (!showBanner && !isOffline) return null;

  return (
    <div
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 ease-in-out",
        // Position it below the header (top-14 is ~56px) so it doesn't block nav
        // Use translate-y to animate it sliding in/out
        showBanner
          ? "top-16 opacity-100 translate-y-0"
          : "top-14 opacity-0 -translate-y-4"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-1.5 rounded-full shadow-lg backdrop-blur-md border text-xs font-medium",
          isOffline
            ? "bg-amber-500/90 text-white border-amber-600/50"
            : "bg-emerald-500/90 text-white border-emerald-600/50"
        )}
      >
        {isOffline ? (
          <>
            <WifiOff className="h-3.5 w-3.5" />
            <span>Offline mode</span>
          </>
        ) : (
          <>
            <Wifi className="h-3.5 w-3.5" />
            <span>Back online</span>
          </>
        )}
      </div>
    </div>
  );
}
