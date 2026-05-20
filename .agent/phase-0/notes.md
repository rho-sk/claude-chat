# Fáza 0 – Setup projektu

## Vytvorené súbory
- `manifest.json` – Obsidian plugin metadata, `isDesktopOnly: true`
- `package.json` – devDeps: esbuild, obsidian, typescript, @types/node
- `tsconfig.json` – target ES2020, moduleResolution bundler
- `esbuild.mjs` – bundluje `src/main.ts` → `dist/main.js`, kopíruje `bridge/` aj `styles.css`

## Kľúčové rozhodnutia
- Plugin bundle: CJS (Obsidian vyžaduje CommonJS)
- Bridge daemon: **nekopíruje sa** cez esbuild ako bundle, len `cpSync` – zachová svoju ESM štruktúru + `node_modules`
- Node builtins (`child_process`, `path`, …) sú `external` – dostupné cez Electron runtime

## Ďalší krok
`npm install` v roote aby sme mali esbuild + obsidian typy.
`npm install` v `bridge/` aby sme mali `@anthropic-ai/claude-agent-sdk`.
