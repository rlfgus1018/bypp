import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The Gemini SDK may only be imported by the single provider file.
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["src/lib/ai/gemini-client.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@google/genai",
              message: "Import the Gemini SDK only in src/lib/ai/gemini-client.ts.",
            },
          ],
        },
      ],
    },
  },
  // Google SDKs: one file each. Everything else talks to the GoogleOAuthClient / GoogleCalendarApi interfaces.
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["src/lib/google/google-oauth-client.ts", "src/lib/google/google-calendar-api.ts", "src/lib/ai/gemini-client.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@google/genai", message: "Import the Gemini SDK only in src/lib/ai/gemini-client.ts." },
            { name: "google-auth-library", message: "Import it only in src/lib/google/google-oauth-client.ts." },
            { name: "@googleapis/calendar", message: "Import it only in src/lib/google/google-calendar-api.ts." },
          ],
        },
      ],
    },
  },
  // The Google layer syncs from the Local CalendarEvent and knows nothing about candidates, messages or extraction.
  {
    files: ["src/lib/google/**/*.ts"],
    ignores: ["src/lib/google/google-oauth-client.ts", "src/lib/google/google-calendar-api.ts", "src/lib/google/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "google-auth-library", message: "Import it only in src/lib/google/google-oauth-client.ts." },
            { name: "@googleapis/calendar", message: "Import it only in src/lib/google/google-calendar-api.ts." },
          ],
          patterns: [
            {
              group: [
                "@/lib/db/repositories/candidates",
                "@/lib/db/repositories/messages",
                "@/lib/db/repositories/imports",
                "@/lib/calendar/candidate-event-link",
                "@/lib/calendar/duplicates",
                "@/lib/pipeline/*",
                "@/lib/ai/*",
                "@/lib/kakao-export/*",
                "@/lib/messages/*",
              ],
              message: "Google sync reads the Local CalendarEvent only — never candidates, messages or the extraction pipeline.",
            },
          ],
        },
      ],
    },
  },
  // UI components never touch server-only modules (LLM, pipeline, DB).
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@google/genai",
              message: "Import the Gemini SDK only in src/lib/ai/gemini-client.ts.",
            },
          ],
          patterns: [
            {
              group: ["@/lib/ai/*", "@/lib/pipeline/*", "@/lib/db/*", "@/lib/db"],
              message: "Components must not import server-only modules. Go through /api or server components.",
            },
            {
              group: ["@/lib/google/*"],
              allowTypeImports: true,
              message: "Components may import Google view TYPES only; tokens and clients stay on the server.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
