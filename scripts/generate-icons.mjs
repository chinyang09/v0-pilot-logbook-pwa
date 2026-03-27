/**
 * Generate PNG icons from icon.svg for the OOOI Pilot Logbook PWA.
 *
 * Usage:
 *   pnpm add -D sharp
 *   node scripts/generate-icons.mjs
 *
 * Outputs (all written to public/):
 *   icon-192.png       — Android / PWA manifest (192×192)
 *   icon-512.png       — Android / PWA manifest (512×512)
 *   apple-icon.png     — Apple touch icon (180×180)
 *   icon-dark-32x32.png  — Favicon, white-on-black (32×32)
 *   icon-light-32x32.png — Favicon, black-on-white (32×32)
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");

const svgSource = await readFile(join(PUBLIC, "icon.svg"), "utf-8");

// The SVG uses prefers-color-scheme media queries which don't apply when
// rasterising server-side. We produce two explicit variants by replacing
// the <style> block with hard-coded fills.

function makeSvgVariant(mode) {
  const isDark = mode === "dark"; // dark = white-on-black (default for dark apps)
  const bg = isDark ? "#000000" : "#FFFFFF";
  const fg = isDark ? "#FFFFFF" : "#000000";

  // Replace the entire <style>...</style> block with inline class styles
  // using a <defs><style> that has no media queries.
  const inlineStyle = `
    <style>
      .bg { fill: ${bg}; }
      .fg { fill: ${fg}; }
      .fg-stroke { stroke: ${fg}; fill: none; }
      .fg-line { stroke: ${fg}; }
    </style>`;

  return svgSource.replace(/<style>[\s\S]*?<\/style>/, inlineStyle.trim());
}

const darkSvg = Buffer.from(makeSvgVariant("dark"));
const lightSvg = Buffer.from(makeSvgVariant("light"));

// Default variant for manifest icons is dark (white-on-black), matching the
// typical dark-mode-first aesthetic of the app.
const defaultSvg = darkSvg;

async function generate(svgBuffer, outputName, size) {
  const png = await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toBuffer();
  const outPath = join(PUBLIC, outputName);
  await writeFile(outPath, png);
  console.log(`  ${outputName} (${size}x${size})`);
}

console.log("Generating PWA icons...\n");

await Promise.all([
  generate(defaultSvg, "icon-192.png", 192),
  generate(defaultSvg, "icon-512.png", 512),
  generate(defaultSvg, "apple-icon.png", 180),
  generate(darkSvg, "icon-dark-32x32.png", 32),
  generate(lightSvg, "icon-light-32x32.png", 32),
]);

console.log("\nDone.");
