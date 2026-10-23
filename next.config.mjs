import { createRequire } from "node:module";
import path from "node:path";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The in-browser OCR engine imports bare `onnxruntime-web`, whose default
 * entry is the JSEP build: WebGPU + WebNN on top of WebAssembly, with a 24MB
 * binary. The engine only ever creates plain WASM sessions, so the extra 12MB
 * was downloaded and compiled for nothing. `./wasm` is the same runtime
 * without them (11.9MB).
 *
 * And the NON-bundled build of it: the bundle inlines the Emscripten glue and
 * starts each engine thread from its own URL, which webpack emits under a
 * content hash nothing can precache — so a threaded engine could not start
 * offline. The plain build imports the glue from `env.wasm.wasmPaths.mjs`, a
 * stable `/models/` URL the service worker holds (scripts/copy-ort-wasm.mjs),
 * and the threads start from there. If the layout ever changes the build
 * simply keeps the default entry.
 */
function ortWasmOnlyEntry() {
  try {
    const fromApp = createRequire(import.meta.url);
    return path.join(path.dirname(fromApp.resolve("onnxruntime-web/wasm")), "ort.wasm.min.mjs");
  } catch {
    return null;
  }
}
const ORT_WASM_ONLY = ortWasmOnlyEntry();

/**
 * A fingerprint of `patches/` (pnpm's patched dependencies), folded into
 * webpack's persistent cache version below.
 *
 * Webpack treats `node_modules` as immutable and re-reads a package only when
 * its `package.json` VERSION changes — and a pnpm patch keeps the version. A
 * build restoring the previous `.next/cache`, which Vercel does, therefore
 * shipped the UNPATCHED module: measured locally, the wheel picker's second
 * patch never reached the bundle until the cache was deleted.
 */
function patchesFingerprint() {
  try {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "patches");
    const hash = createHash("sha256");
    for (const name of readdirSync(dir).sort()) hash.update(name).update(readFileSync(path.join(dir, name)));
    return hash.digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}
const PATCHES_FINGERPRINT = patchesFingerprint();

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    // Lint is run explicitly via `pnpm lint` (CI/local), not during the
    // production build — mirrors typescript.ignoreBuildErrors so a lint warning
    // never blocks a deploy.
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  // PROFILE_BUILD=1 only: ship source maps so a CPU profile names functions.
  productionBrowserSourceMaps: process.env.PROFILE_BUILD === "1",
  compiler: {
    // Strip console.* from production client bundles (SWC transform — applies
    // even with the webpack bundler). The app logs verbosely ([Sync], [Auth],
    // [FDP-chart] per-render diagnostics…), which costs real time on iOS.
    // error/warn are kept so production issues still surface.
    removeConsole: { exclude: ["error", "warn"] },
  },
  // Empty turbopack config to allow webpack config for builds
  turbopack: {},
  // Cross-origin ISOLATION, which is what hands the page SharedArrayBuffer
  // and so lets the in-browser OCR engine run on several threads
  // (lib/ocr/engine/browser.ts). Everything the app loads is same-origin
  // except Google Fonts, which is fetched in CORS mode (crossOrigin=
  // "anonymous") and so satisfies `require-corp`. `credentialless` would be
  // laxer but Safari does not support it, and both platforms must behave the
  // same. A page served from an older cache without these headers simply
  // runs the engine single-threaded.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (PATCHES_FINGERPRINT && config.cache && typeof config.cache === "object") {
      config.cache.version = `${config.cache.version ?? ""}|patches:${PATCHES_FINGERPRINT}`;
    }
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({ sharp: "commonjs sharp" });
    } else {
      // Client-side: provide fallbacks for Node.js modules
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
      if (ORT_WASM_ONLY) {
        config.resolve.alias = { ...config.resolve.alias, "onnxruntime-web$": ORT_WASM_ONLY };
      }
    }

    // Ignore ONNX and large binary files from webpack processing
    config.module = config.module || {};
    config.module.noParse = config.module.noParse || [];
    if (!Array.isArray(config.module.noParse)) {
      config.module.noParse = [config.module.noParse];
    }
    config.module.noParse.push(/\.onnx$/);
    config.module.noParse.push(/\.wasm$/);

    return config;
  },
  // File tracing decides what ships inside each serverless function.
  //
  // Server OCR (`/api/ocr`) needs onnxruntime-node, sharp and the two models
  // in @gutenye/ocr-models. Those used to be excluded wholesale (a
  // `.pnpm/**/*@gutenye*` pattern), so the deployed route could not load its
  // engine and EVERY photo was uploaded, refused, and then read by the slow
  // in-browser engine from cold. The weight that exclusion was avoiding is
  // onnxruntime-node's binaries for six platforms (~247MB); a function only
  // ever runs linux-x64 (32MB), so only the other five are dropped.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/kerberos/**/*",
      // Browser model files (served via public/)
      "public/models/**/*",
      // onnxruntime-node ships every platform's binary; Vercel runs linux-x64.
      "node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/darwin/**/*",
      "node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/win32/**/*",
      "node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**/*",
    ],
  },
  // What the tracer cannot see: the models are opened by a path computed at
  // runtime (`@gutenye/ocr-models/node`), and the native library is loaded by
  // the binding rather than imported.
  outputFileTracingIncludes: {
    "/api/ocr": [
      "node_modules/.pnpm/@gutenye+ocr-models@*/node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx",
      "node_modules/.pnpm/@gutenye+ocr-models@*/node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx",
      "node_modules/.pnpm/@gutenye+ocr-models@*/node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt",
      "node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/linux/x64/**/*",
    ],
  },
  // Native modules and runtime-resolved model paths: loaded by Node, not bundled.
  serverExternalPackages: ["@gutenye/ocr-models", "onnxruntime-node", "sharp"],
};

export default nextConfig;
