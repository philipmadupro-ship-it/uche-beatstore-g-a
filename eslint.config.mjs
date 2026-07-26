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
    // Local agent/worktree artifacts are not part of the active app source.
    ".claude/**",
    ".codex/**",
    ".kilo/**",
    // Python venv that bundles its own JS — not our code:
    "stem-service/**",
    "data/**",
    // Unrelated generated Remix/Vite workspace artifact; Beatstor lint should
    // cover the Next app source, not bundled build output from another project.
    "Remix:-PATTERN-MACHINE/**",
  ]),
]);

export default eslintConfig;
