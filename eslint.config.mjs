import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Utility scripts (CommonJS, not part of Next.js app):
    "opensky-proxy/**",
    "scripts/**",
    "prisma/seed*.js",
  ]),
  {
    rules: {
      // Downgrade to warning — pervasive across the codebase; fixing 150+
      // occurrences risks merge conflicts and regressions.
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars: warn only, ignore prefixed with _
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // These react-hooks rules fire on valid patterns (data fetching in
      // effects, derived state from props, mounted guards).
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // Unescaped entities — too strict for apostrophes in prose.
      "react/no-unescaped-entities": "off",
      // <img> vs <Image /> — profile pictures use dynamic base64 data URIs
      // that next/image doesn't support without a custom loader.
      "@next/next/no-img-element": "warn",
    },
  },
]);

export default eslintConfig;

