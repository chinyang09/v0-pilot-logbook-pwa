"use client";

/**
 * The import button — ONE entry point for every report and export the app
 * reads (eCrew schedule + crew logbook, LogTen Pro), see `import-flow.tsx`.
 *
 * Only the button and its file picker live here. The picker must open inside
 * the tap (iOS refuses a file input opened outside the gesture), so it cannot
 * wait for code to load; everything that happens AFTER the files are chosen —
 * every parser, the reconciler, the executor, the review dialogs, ~120KB — is
 * loaded then (`ImportFlow`, `React.lazy`). It is warmed when the page is idle
 * so the service worker holds the chunk and an offline import still finds it.
 */

import * as React from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { whenIdle } from "@/lib/utils/idle";

const loadFlow = () => import("./import-flow");
const ImportFlow = React.lazy(() => loadFlow().then((m) => ({ default: m.ImportFlow })));

interface Props {
  /** Where the button is mounted — affects success-message wording. */
  context?: "logbook" | "roster" | "shared";
  /** Triggered after a successful execution so the page can refresh. */
  onComplete?: () => void;
}

export function UnifiedImportButton({ context = "shared", onComplete }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [request, setRequest] = React.useState<{ key: number; files: File[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  // The flow's code is still on its way: the button says so rather than
  // doing nothing.
  const loading = request !== null && !ready;

  React.useEffect(() => {
    // Off the first load, but fetched once the page is idle — so it is in the
    // service worker's cache for an import made offline.
    let alive = true;
    whenIdle(() => {
      void loadFlow().then(() => {
        if (alive) setReady(true);
      });
    }, 4000);
    return () => {
      alive = false;
    };
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setRequest((prev) => ({ key: (prev?.key ?? 0) + 1, files }));
    void loadFlow().then(() => setReady(true));
  };
  const resetPicker = React.useCallback(() => {
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return (
    <>
      <input
        type="file"
        ref={inputRef}
        className="hidden"
        accept=".csv,.pdf,.txt,.tsv"
        multiple
        onChange={onChange}
      />

      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        aria-label="Import files"
        className="h-10 w-10 rounded-full"
        onClick={() => inputRef.current?.click()}
      >
        {busy || loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
      </Button>

      {request && (
        <React.Suspense fallback={null}>
          <ImportFlow
            context={context}
            onComplete={onComplete}
            request={request}
            onBusyChange={setBusy}
            onResetPicker={resetPicker}
          />
        </React.Suspense>
      )}
    </>
  );
}
