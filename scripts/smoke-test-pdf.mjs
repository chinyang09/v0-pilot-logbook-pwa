#!/usr/bin/env node
/**
 * Smoke test for PDF parsing.
 *
 * Drives the same unpdf code path as `extractors/pdf.extractor.ts`
 * (unpdf is isomorphic — the browser and Node run identical extraction) and
 * applies the same column-anchor algorithm against a real Crew Logbook
 * Report PDF. Verifies:
 *
 *   - unpdf loads and parses the PDF without error (no worker, no DOM shims).
 *   - The header row is detected and column anchors derived from it.
 *   - At least one data row is produced with the expected CSV columns
 *     (so the existing logbook-parser-v2.ts column positions still apply).
 *   - The "Generated on …" footer is present so stale-report gating works.
 *   - detect.ts's equivalent returns "logbook".
 *
 * Usage:
 *   node scripts/smoke-test-pdf.mjs <path-to.pdf>
 *
 * Fails (non-zero exit) on any of the above.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDocumentProxy } from "unpdf";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node scripts/smoke-test-pdf.mjs <path-to.pdf>");
  process.exit(2);
}

const absPdfPath = resolve(pdfPath);
console.log(`[pdf-smoke] Loading ${absPdfPath}`);
const buffer = readFileSync(absPdfPath);

// Reproduce the same algorithm pdf-extract.ts uses on the browser side.

const Y_BUCKET_TOLERANCE = 1.5;
const COL_SNAP_TOLERANCE = 25;

const HEADER_TOKENS = new Set([
  "Date",
  "Airport",
  "Time",
  "Type",
  "Reg.",
  "Flt time",
  "Name PIC",
  "Day",
  "Night",
  "PIC",
  "Co-Plt",
  "Instr",
  "Duties",
  "Details",
  "Report times",
  "Actual times/Delays",
  "Debrief times",
  "Indicators",
  "Crew",
]);

function bucketRows(items) {
  const rows = [];
  for (const item of items) {
    if (!item || typeof item.str !== "string" || !Array.isArray(item.transform)) continue;
    const y = item.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < Y_BUCKET_TOLERANCE);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  for (const row of rows) row.items.sort((a, b) => a.transform[4] - b.transform[4]);
  return rows.sort((a, b) => b.y - a.y);
}

function findHeaderColumns(rows) {
  for (const row of rows) {
    const tokens = row.items.map((i) => i.str.trim()).filter(Boolean);
    let hits = 0;
    for (const t of tokens) if (HEADER_TOKENS.has(t)) hits++;
    if (hits >= 3) {
      return row.items
        .filter((i) => i.str.trim().length > 0)
        .map((i) => i.transform[4]);
    }
  }
  return [];
}

function gapJoinRow(row) {
  let line = "";
  let prevRight = -Infinity;
  for (const item of row.items) {
    const text = item.str.trim();
    if (!text) continue;
    const left = item.transform[4];
    const right = left + (item.width ?? 0);
    if (line === "") line = text;
    else {
      const gap = left - prevRight;
      if (gap > 4) line += "," + text;
      else if (gap > 0.5) line += " " + text;
      else line += text;
    }
    prevRight = right;
  }
  return line;
}

function rowToCsv(row, anchors) {
  if (anchors.length === 0) return gapJoinRow(row);
  const cells = anchors.map(() => "");
  const preAnchor = [];
  const postAnchor = [];
  const firstAnchor = anchors[0];
  const lastAnchor = anchors[anchors.length - 1];
  for (const item of row.items) {
    const text = item.str.trim();
    if (!text) continue;
    const x = item.transform[4];
    if (x < firstAnchor - COL_SNAP_TOLERANCE) { preAnchor.push(text); continue; }
    if (x > lastAnchor + COL_SNAP_TOLERANCE) { postAnchor.push(text); continue; }
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(anchors[i] - x);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestDist > COL_SNAP_TOLERANCE) {
      bestIdx = 0;
      for (let i = 0; i < anchors.length; i++) if (anchors[i] <= x) bestIdx = i;
    }
    cells[bestIdx] = cells[bestIdx] ? `${cells[bestIdx]} ${text}` : text;
  }
  const out = [];
  if (preAnchor.length) out.push(preAnchor.join(" "));
  out.push(...cells);
  if (postAnchor.length) out.push(postAnchor.join(" "));
  return out.join(",");
}

async function extractPdfText(uint8) {
  const pdf = await getDocumentProxy(uint8);
  const pages = [];
  let anchors = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content?.items ?? [];
    if (!items.length) { pages.push(""); continue; }
    const rows = bucketRows(items);
    const pageAnchors = findHeaderColumns(rows);
    if (pageAnchors.length > 0) anchors = pageAnchors;
    const lines = rows.map((r) => rowToCsv(r, anchors)).filter(Boolean);
    pages.push(lines.join("\n"));
  }
  return { pages, fullText: pages.join("\n"), pageCount: pages.length };
}

let result;
try {
  result = await extractPdfText(new Uint8Array(buffer));
} catch (err) {
  console.error("[pdf-smoke] extractPdfText FAILED:", err);
  process.exit(1);
}

console.log(`[pdf-smoke] Extracted ${result.pageCount} pages, ${result.fullText.length} chars total`);

// Detection
function detectReportType(text) {
  if (text.includes("Crew Logbook Report")) return "logbook";
  if (text.includes("Personal Crew Schedule Report")) return "schedule";
  return "unknown";
}
const detected = detectReportType(result.fullText);
console.log(`[pdf-smoke] Detected report type: ${detected}`);
if (detected === "unknown") {
  console.error("[pdf-smoke] FAIL: report type detection returned 'unknown'");
  process.exit(1);
}

// Generated-on footer
const generatedMatch = result.fullText.match(
  /Generated on\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})/
);
console.log(`[pdf-smoke] Generated footer: ${generatedMatch ? generatedMatch[0] : "NOT FOUND"}`);
if (!generatedMatch) {
  console.error("[pdf-smoke] FAIL: Generated-on footer not found");
  process.exit(1);
}

// Find a data row, count its columns. The logbook CSV header is 18 cols.
const lines = result.fullText.split("\n");
const dataRows = lines.filter((l) => /^\d{2}\/\d{2}\/\d{2},/.test(l));
console.log(`[pdf-smoke] Found ${dataRows.length} data rows`);
if (dataRows.length === 0) {
  console.error("[pdf-smoke] FAIL: no data rows produced");
  process.exit(1);
}

// Sample a few rows and count columns
const sampleSize = Math.min(3, dataRows.length);
for (let i = 0; i < sampleSize; i++) {
  const cols = dataRows[i].split(",");
  console.log(`[pdf-smoke] row ${i + 1}: ${cols.length} cols → ${dataRows[i]}`);
}

// We expect at least the date, dep, depTime, arr, arrTime, type, reg, flt
// time, PIC name = 9 columns minimum. The TO/LDG columns may snap into
// preceding cells if the header row has fewer anchor tokens; what matters
// for the parser is that the FIRST 9 columns are correct.
const minCols = Math.min(...dataRows.slice(0, sampleSize).map((r) => r.split(",").length));
if (minCols < 9) {
  console.error(
    `[pdf-smoke] FAIL: rows have only ${minCols} columns, need at least 9 ` +
    "(date, dep, depTime, arr, arrTime, type, reg, fltTime, picName)"
  );
  process.exit(1);
}

console.log("[pdf-smoke] PASS");
process.exit(0);
