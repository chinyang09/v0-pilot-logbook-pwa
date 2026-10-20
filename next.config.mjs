import { createRequire } from "node:module";
import path from "node:path";

/**
 * The in-browser OCR engine imports bare `onnxruntime-web`, whose default
 * entry is the JSEP build: WebGPU + WebNN on top of WebAssembly, with a 24MB
 * binary. The engine only ever creates plain WASM sessions, so the extra 12MB
 * was downloaded and compiled for nothing. `./wasm` is the same runtime
 * without them (11.9MB). Resolved from ocr-browser, whose dependency it is;
 * if the layout ever changes the build simply keeps the default entry.
 */
function ortWasmOnlyEntry() {
  try {
    const fromApp = createRequire(import.meta.url);
    const fromOcr = createRequire(fromApp.resolve("@gutenye/ocr-browser"));
    return path.join(path.dirname(fromOcr.resolve("onnxruntime-web/wasm")), "ort.wasm.bundle.min.mjs");
  } catch {
    return null;
  }
}
const ORT_WASM_ONLY = ortWasmOnlyEntry();

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
  compiler: {
    // Strip console.* from production client bundles (SWC transform — applies
    // even with the webpack bundler). The app logs verbosely ([Sync], [Auth],
    // [FDP-chart] per-render diagnostics…), which costs real time on iOS.
    // error/warn are kept so production issues still surface.
    removeConsole: { exclude: ["error", "warn"] },
  },
  // Empty turbopack config to allow webpack config for builds
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Server-side: Exclude browser-only OCR packages
      // Keep ocr-node available for server-side API routes
      config.externals = config.externals || [];
      config.externals.push({
        // Browser OCR - not needed on server
        '@gutenye/ocr-browser': 'commonjs @gutenye/ocr-browser',
        '@techstark/opencv-js': 'commonjs @techstark/opencv-js',
        // Sharp is used by ocr-node, handle it specially
        'sharp': 'commonjs sharp',
      });
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
  // Server OCR (`/api/ocr`) needs @gutenye/ocr-node, ocr-common, ocr-models,
  // onnxruntime-node, sharp and @techstark/opencv-js (ocr-common's line
  // splitter). These used to be excluded wholesale — `.pnpm/**/*@gutenye*`
  // matches every gutenye package in pnpm's store, ocr-node included — so the
  // deployed route failed with "Cannot find package '@gutenye/ocr-node'" and
  // EVERY photo was uploaded, refused, and then read by the slow in-browser
  // engine from cold. The weight that exclusion was avoiding is
  // onnxruntime-node's binaries for six platforms (~247MB); a function only
  // ever runs linux-x64 (32MB), so only the other five are dropped.
  outputFileTracingExcludes: {
    "*": [
      // Browser OCR (the client loads it; the service worker caches it)
      "node_modules/@gutenye/ocr-browser/**/*",
      "node_modules/.pnpm/@gutenye+ocr-browser@*/**/*",
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
  // Enable server external packages for ocr-node dependencies.
  serverExternalPackages: [
    '@gutenye/ocr-node',
    '@gutenye/ocr-common',
    '@gutenye/ocr-models',
    'onnxruntime-node',
    'sharp',
  ],
};

export default nextConfig;
