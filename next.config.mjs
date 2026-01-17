/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // This prevents the "Maximum call stack" error during the "Collecting build traces" phase
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@gutenye/ocr-browser/**/*",
      "node_modules/@gutenye/ocr-models/**/*",
      "node_modules/sharp/**/*",
      "**/*.onnx",
      "**/*.wasm",
      "public/models/**/*",
    ],
  },
};

export default nextConfig;
