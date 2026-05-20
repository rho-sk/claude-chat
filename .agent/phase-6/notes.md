# Fáza 6 – Build pipeline & distribúcia

## Build príkazy

```bash
# 1. Inštalácia závislostí (raz)
npm install                    # root: esbuild, obsidian typy, typescript
cd bridge && npm install       # bridge: @anthropic-ai/claude-agent-sdk

# 2. Development build (s source maps)
npm run dev

# 3. Produkčný build (minified, bez source maps)
npm run build
# Výstup v dist/:
#   dist/main.js       ← bundled plugin
#   dist/manifest.json
#   dist/styles.css
#   dist/bridge/       ← daemon + node_modules (nekopíruje sa cez esbuild)
```

## Inštalácia do Obsidian (development)

```bash
# Symlink alebo kopírovanie dist/ do vault
ln -s /path/to/dist ~/.obsidian/plugins/claude-chat

# Alebo manuálne:
cp -r dist/ /path/to/vault/.obsidian/plugins/claude-chat/
```

## Štruktúra dist/

```
dist/
  main.js          ← CJS bundle (Obsidian plugin)
  manifest.json
  styles.css
  bridge/
    daemon.js      ← ACP daemon (ESM)
    async-stream.js
    package.json
    node_modules/
      @anthropic-ai/claude-agent-sdk/
```

## Predpoklady na strane usera

1. **Node.js** – dostupný v PATH (Electron má vlastný Node, ale `child_process.spawn('node', ...)` potrebuje systémový)
2. **`@anthropic-ai/claude-agent-sdk`** – nainštalovaný cez `npm install` v `bridge/`
3. **Claude Code** – nakonfigurovaný (API kľúč, atď.)

## Ďalšie kroky (post-MVP)

- [ ] Auto-inštalácia SDK cez plugin (podobne ako JetBrains DependencyManager)
- [ ] Bundlovanie daemona cez esbuild (jeden súbor, bez node_modules)
- [ ] História konverzácií (uložená ako .md súbory vo vault)
- [ ] Permission UI (interaktívne schvaľovanie tool calls)
- [ ] Streaming (delty namiesto celých správ) pre rýchlejší UX
- [ ] Multi-session (tabed view)
