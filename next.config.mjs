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
  // Disable Turbopack for development to support OCR packages
  experimental: {
    // Use webpack for dev server (Turbopack has UTF-8 parsing issues with some OCR deps)
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Server-side: externalize OCR packages that contain native modules
      // These packages have native .node binaries that webpack can't bundle
      config.externals = config.externals || [];
      config.externals.push({
        '@gutenye/ocr-browser': 'commonjs @gutenye/ocr-browser',
        '@gutenye/ocr-node': 'commonjs @gutenye/ocr-node',
        '@techstark/opencv-js': 'commonjs @techstark/opencv-js',
        'onnxruntime-node': 'commonjs onnxruntime-node',
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

    // Ignore ONNX, WASM, and native binary files
    config.module = config.module || {};
    config.module.noParse = config.module.noParse || [];
    if (!Array.isArray(config.module.noParse)) {
      config.module.noParse = [config.module.noParse];
    }
    config.module.noParse.push(/\.onnx$/);
    config.module.noParse.push(/\.wasm$/);
    config.module.noParse.push(/\.node$/);

    return config;
  },
  // Exclude OCR-related files from file tracing
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@gutenye/**/*",
      "node_modules/@mongodb-js/**/*",
      "node_modules/mongodb/**/*",
      "node_modules/mongodb-client-encryption/**/*",
      "node_modules/kerberos/**/*",
      "node_modules/sharp/**/*",
      "node_modules/.pnpm/**/*@gutenye*/**/*",
      "**/*.onnx",
      "**/*.wasm",
      "**/*.node",
      "public/models/**/*",
    ],
  },
};

export default nextConfig;
