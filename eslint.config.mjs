import nextCoreWebVitals from "eslint-config-next/core-web-vitals"

// eslint-config-next@16 ships native flat-config arrays, so they are spread
// directly (wrapping them in FlatCompat double-wraps the plugins and throws a
// "circular structure" error).
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "public/**",
      "node_modules/**",
      // Separate Cloudflare Worker sub-project with its own tsconfig/runtime.
      "cloudflare-worker/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      // eslint-plugin-react-hooks v6 (bundled by Next 16) ships the
      // React-Compiler lint suite. These rules are advisory for a codebase not
      // authored under the compiler — surface them as warnings so they guide
      // future work without failing CI, while the load-bearing
      // rules-of-hooks/exhaustive-deps rules keep their default severities.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
]

export default eslintConfig
