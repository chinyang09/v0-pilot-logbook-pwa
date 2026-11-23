"use client";

/**
 * The import picker — ONE entry point for every report and export the app
 * reads (eCrew schedule + crew logbook, LogTen Pro, a briefing package), see
 * `import-flow.tsx`. It lives on the Import page (`/import`, a nav
 * destination — the owner, Nov 2026: imports and exports in a tab of their
 * own, not an action button).
 *
 * Only the picker lives here. It must open inside the tap (iOS refuses a file
 * input opened outside the gesture), so it cannot wait for code to load;
 * everything that happens AFTER the files are chosen — every parser, the
 * reconciler, the executor, the review dialogs, ~120KB — is loaded then
 * (`ImportFlow`, `React.lazy`). It is warmed when the page is idle so the
 * service worker holds the chunk and an offline import still finds it.
 */

import * as React from "react";
import { whenIdle } from "@/lib/utils/idle";

const loadFlow = () => import("./import-flow");
const ImportFlow = React.lazy(() => loadFlow().then((m) => ({ default: m.ImportFlow })));

interface Options {
  /** Where the picker is mounted — affects success-message wording. */
  context?: "logbook" | "roster" | "shared";
  /** Triggered after a successful execution so the page can refresh. */
  onComplete?: () => void;
}

/**
 * The picker and the flow behind it. `element` is mounted once by the page;
 * `open` is called from any control's tap (it must be, for iOS).
 */
export function useImportPicker({ context = "shared", onComplete }: Options = {}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [request, setRequest] = React.useState<{ key: number; files: File[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  // The flow's code is still on its way: the control says so rather than doing nothing.
  const loading = request !== null && !ready;

  React.useEffect(() => {
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

  // Files from the picker, or dropped on a drop zone: the same flow.
  const take = React.useCallback((files: File[]) => {
    if (files.length === 0) return;
    setRequest((prev) => ({ key: (prev?.key ?? 0) + 1, files }));
    void loadFlow().then(() => setReady(true));
  }, []);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => take(Array.from(e.target.files ?? []));
  const resetPicker = React.useCallback(() => {
    if (inputRef.current) inputRef.current.value = "";
  }, []);
  const open = React.useCallback(() => inputRef.current?.click(), []);

  const element = (
    <>
      <input type="file" ref={inputRef} className="hidden" accept=".csv,.pdf,.txt,.tsv" multiple onChange={onChange} />
      {request && (
        <React.Suspense fallback={null}>
          <ImportFlow context={context} onComplete={onComplete} request={request} onBusyChange={setBusy} onResetPicker={resetPicker} />
        </React.Suspense>
      )}
    </>
  );
  return { open, take, working: busy || loading, element };
}
