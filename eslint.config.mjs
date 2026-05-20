// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    files: ["**/*.ts"],
    plugins: { obsidianmd, "@typescript-eslint": tseslint.plugin },
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      ...obsidianmd.configs.recommended,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/require-await": "error",
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: ["Claude", "Claude Code"],
          acronyms: ["URL", "ACP", "API", "JSON", "ID", "CWD", "MCP", "UUID"],
        },
      ],
    },
  },
]);
