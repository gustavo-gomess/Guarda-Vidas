import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Use the logger (src/lib/logger.ts), which redacts sensitive data.
      "no-console": "error",
      // Read configuration through getEnv() (src/env.ts), which validates it.
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: 'Use `getEnv()` from "@/env" (validated) instead.',
        },
      ],
    },
  },
  {
    // The only places allowed to touch console or process.env directly.
    // Command-line scripts print to the terminal and load their own env.
    files: ["src/lib/logger-core.ts", "scripts/**"],
    rules: { "no-console": "off" },
  },
  {
    files: [
      "src/env.ts",
      "src/instrumentation.ts",
      "next.config.ts",
      "prisma7.config.ts",
      "scripts/**",
    ],
    rules: { "no-restricted-properties": "off" },
  },
  // Must stay last: turns off rules that conflict with Prettier formatting.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
