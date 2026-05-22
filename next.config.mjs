/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
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
  // Exclude certain files from file tracing
  // Note: We keep ocr-node models included for server-side OCR
  outputFileTracingExcludes: {
    "*": [
      // Browser OCR (client handles this via service worker)
      "node_modules/@gutenye/ocr-browser/**/*",
      "node_modules/@techstark/opencv-js/**/*",
      // Other exclusions
      "node_modules/kerberos/**/*",
      "node_modules/.pnpm/**/*@gutenye*/**/*",
      // Browser model files (served via public/)
      "public/models/**/*",
    ],
  },
  // Force-include the pdfjs worker for the server-side /api/parse-pdf route.
  // pdfjs spawns a "fake worker" in Node by dynamically importing
  // pdf.worker.mjs; @vercel/nft can't follow that computed import, so we
  // trace it explicitly here. (pdfjs-dist is also kept external below so the
  // import resolves against real node_modules at runtime.)
  outputFileTracingIncludes: {
    "/api/parse-pdf": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    ],
  },
  // Enable server external packages for ocr-node dependencies + pdfjs.
  // Keeping pdfjs-dist external (unbundled) means its internal
  // `import('./pdf.worker.mjs')` resolves correctly relative to the real
  // node_modules location instead of a non-existent bundled chunk path.
  serverExternalPackages: [
    '@gutenye/ocr-node',
    '@gutenye/ocr-common',
    '@gutenye/ocr-models',
    'onnxruntime-node',
    'sharp',
    'pdfjs-dist',
  ],
};

export default nextConfig;
