#!/usr/bin/env node
/**
 * Copy the pdfjs-dist worker bundle into public/workers so Next.js serves
 * it as a static asset and pdf-extract.ts can point GlobalWorkerOptions
 * .workerSrc at a stable URL ("/workers/pdf.worker.min.mjs").
 *
 * Runs before `pnpm dev` and `pnpm build` (and on `pnpm install` via
 * the postinstall hook), so contributors don't need to remember it.
 *
 * Idempotent and silent on success — only logs when it actually copies.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const SRC = resolve(
  repoRoot,
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"
);
const DEST_DIR = resolve(repoRoot, "public/workers");
const DEST = resolve(DEST_DIR, "pdf.worker.min.mjs");

if (!existsSync(SRC)) {
  // pdfjs-dist may not be installed yet (e.g., in CI before pnpm install).
  // Postinstall will retry; build will fail loudly if it's still missing.
  console.warn("[copy-pdf-worker] source not found, skipping:", SRC);
  process.exit(0);
}

mkdirSync(DEST_DIR, { recursive: true });

const srcStat = statSync(SRC);
const destStat = existsSync(DEST) ? statSync(DEST) : null;

if (
  destStat &&
  destStat.size === srcStat.size &&
  destStat.mtimeMs >= srcStat.mtimeMs
) {
  // Up to date.
  process.exit(0);
}

copyFileSync(SRC, DEST);
console.log(
  `[copy-pdf-worker] copied ${(srcStat.size / 1024).toFixed(0)} KB → public/workers/pdf.worker.min.mjs`
);
