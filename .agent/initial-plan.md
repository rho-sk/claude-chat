# Claude Code Chat – Obsidian Plugin – Implementačný plán

## Kontext & cieľ

Chceme Obsidian plugin, ktorý umožní chatovať s Claude Code priamo z Obsidianu –
podobne ako opencode-chat, ale miesto OpenCode servera komunikujeme s Claude Code
cez ACP (Agent Communication Protocol) pomocou `@anthropic-ai/claude-agent-sdk`.

## Analýza inšpirácií

### opencode-chat (Obsidian plugin)
- TypeScript plugin, `Plugin` → `ItemView` vzor
- Komunikuje s externým serverom cez **HTTP REST + SSE** (port 4096)
- UI: čistý DOM (žiadny framework), Obsidian `MarkdownRenderer`
- Preberie sa: celá pluginová kostra, build pipeline (esbuild), UI vzory, SSE streaming

### jetbrains-cc-gui
- Java + React (JCEF webview)
- **Kľúčová časť**: `ai-bridge/daemon.js` – dlhobežiaci Node.js proces
  - Načíta `@anthropic-ai/claude-agent-sdk` raz → rýchly štart
  - Komunikácia s Java cez **stdin/stdout NDJSON**
  - Protokol: `{"id":"1","method":"claude.send","params":{...}}` → `{"id":"1","line":"..."}` → `{"id":"1","done":true}`
  - Heartbeat každých 15s, auto-restart (max 3×)
- Preberie sa: daemon.js vzor, NDJSON protokol, streaming s request-ID demuxingom

---

## Navrhovaná architektúra

```
Obsidian (Electron / Node.js runtime)
  └─ claude-chat Plugin (TypeScript)
       ├─ Chat View (DOM UI, Obsidian API)
       ├─ IPC Layer (child_process.spawn)
       │    ↕ stdin/stdout NDJSON
       └─ ACP Bridge Daemon (Node.js, bundled)
            └─ @anthropic-ai/claude-agent-sdk
                 └─ Claude Code (lokálny agent, CWD = vault alebo iný projekt)
```

### Prečo samostatný daemon a nie priamy import SDK?
- SDK môže mať native moduly – daemon izoluje problém
- Jednoduchší upgrade SDK bez rebuild pluginu
- Osvedčený vzor z JetBrains implementácie
- Daemon sa môže reštartovať bez reloadu pluginu

### Prečo nie HTTP server (ako opencode)?
- opencode je externý binárny program, ktorý musí bežať bokom
- Claude Code / ACP SDK nevystavuje HTTP API z boxu
- Daemon cez spawn je jednoduchší pre end-usera (žiadna externá inštalácia servera)

---

## Štruktúra projektu

```
claude-chat/
├── src/
│   ├── main.ts              # Plugin entry point (Plugin class)
│   ├── view.ts              # ChatView (ItemView)
│   ├── ipc.ts               # IPC Layer – spawn daemon, NDJSON encode/decode
│   ├── types.ts             # Zdieľané typy (Message, Session, DaemonEvent, …)
│   └── settings.ts          # Settings tab + defaults
├── bridge/
│   ├── daemon.js            # ACP Bridge Daemon (Node.js, CJS)
│   ├── channel.js           # claude-agent-sdk wrapper
│   └── package.json         # { dependencies: { @anthropic-ai/claude-agent-sdk } }
├── styles.css
├── manifest.json
├── package.json             # Plugin build deps (esbuild, obsidian, typescript)
├── tsconfig.json
└── esbuild.mjs              # Build script (plugin bundle + daemon copy)
```

---

## Protokol: Plugin ↔ Daemon (NDJSON cez stdin/stdout)

### Plugin → Daemon (stdin)
```jsonc
// Odoslanie správy
{"id":"1","method":"claude.send","params":{"message":"...","sessionId":"abc","cwd":"/vault","model":"claude-sonnet-4-6"}}

// Prerušenie
{"id":"2","method":"claude.abort","params":{"sessionId":"abc"}}

// Ping (každých 15s)
{"id":"hb-1234","method":"heartbeat","params":{}}
```

### Daemon → Plugin (stdout)
```jsonc
// Daemon ready
{"type":"daemon","event":"ready","pid":1234}

// Streaming chunk
{"id":"1","line":"[CONTENT_DELTA] \"text chunk\""}

// Tool use
{"id":"1","line":"[TOOL_USE] {\"name\":\"bash\",\"input\":{\"command\":\"ls\"}}"}

// Completion
{"id":"1","done":true,"success":true}

// Chyba
{"id":"1","done":true,"success":false,"error":"message"}

// Heartbeat response
{"id":"hb-1234","type":"heartbeat","ts":1234567890}
```

---

## Fázy implementácie

### Fáza 0 – Setup projektu
- [ ] `manifest.json` s `id: claude-chat`, `minAppVersion: 1.0.0`, `isDesktopOnly: true`
- [ ] `package.json` s Obsidian, TypeScript, esbuild závislosťami
- [ ] `tsconfig.json` (cielí ES2020, `moduleResolution: bundler`)
- [ ] `esbuild.mjs` – bundluje `src/main.ts` → `dist/main.js`, kopíruje `bridge/`
- [ ] `.gitignore`, základná README

### Fáza 1 – ACP Bridge Daemon (`bridge/`)
- [ ] `bridge/package.json` – závislosť na `@anthropic-ai/claude-agent-sdk`
- [ ] `bridge/channel.js` – obaľuje SDK, volá `query()` / `streamQuery()`, tagguje output riadky
- [ ] `bridge/daemon.js` – NDJSON loop:
  - čítanie stdin riadok po riadku (readline)
  - dispatch na channel.js podľa `method`
  - heartbeat watchdog
  - auto-restart logika
- [ ] Manuálny test: `echo '{"id":"1","method":"claude.send","params":{"message":"hi","cwd":"/tmp"}}' | node bridge/daemon.js`

### Fáza 2 – IPC Layer (`src/ipc.ts`)
- [ ] Trieda `DaemonBridge`:
  - `spawn()` – spustí `node bridge/daemon.js`, čaká na `ready` event
  - `send(method, params)` → Promise<string[]> (streamed lines)
  - `abort(sessionId)`
  - heartbeat timer (každých 15s, restart ak žiadna odpoveď 45s)
  - request-ID counter + Map<id, callbacks> pre demuxing
  - event emitter pre streamed riadky

### Fáza 3 – Plugin kostra (`src/main.ts`, `src/settings.ts`)
- [ ] `ClaudeChatPlugin extends Plugin`:
  - `onload()`: registerView, ribbonIcon, settingTab, spawn DaemonBridge
  - `onunload()`: ukončí daemon
- [ ] Settings:
  - `cwd` – pracovný adresár pre Claude Code (default: vault root)
  - `model` – model (default: `claude-sonnet-4-6`)
  - `sendKey` – `ctrl+enter` | `enter`
  - `permissionMode` – `default` | `bypassPermissions`

### Fáza 4 – Chat View (`src/view.ts`)
- [ ] `ClaudeChatView extends ItemView`:
  - Sidebar panel s message listom a input boxom
  - `onOpen()`: render UI, pripojiť event handlery
  - `sendMessage()`: volá `DaemonBridge.send()`, streamuje odpoveď do UI
  - `renderMessage(msg)`: user = plain text, assistant = `MarkdownRenderer.render()`
  - Tool use rendering: collapsible rows (tool name, input, output, status)
  - Busy state (disable input počas generovania)
  - Abort button (volá `DaemonBridge.abort()`)
- [ ] Session management:
  - Lokálne sessions (in-memory + optional persist do vault súboru)
  - "New chat" tlačidlo
  - Session title (generovaný z prvej správy)

### Fáza 5 – Styling (`styles.css`)
- [ ] Obsidian CSS variables pre farby/fonty
- [ ] Message bubbles (user/assistant distinction)
- [ ] Tool use rows
- [ ] Loading spinner
- [ ] Responsive (bočný panel)

### Fáza 6 – Build & distribúcia
- [ ] `esbuild.mjs` produkčný build s minifikáciou
- [ ] `build.sh` – build + zip pre distribúciu
- [ ] Inštalácia: rozbalenie do `[vault]/.obsidian/plugins/claude-chat/`

---

## Otvorené otázky / rozhodnutia

| Otázka | Možnosti | Odporúčanie |
|--------|---------|-------------|
| Ako spustiť daemon? | `node bridge/daemon.js` (vyžaduje lokálny node) | node je prítomný na desktope, OK |
| CWD pre Claude Code | vault root / konfigurovateľné / per-session | konfigurovateľné v settings |
| Persistencia sessions | In-memory / markdown súbory vo vault | markdown súbory (konzistentné s Obsidianom) |
| Permissions | bypassPermissions / interaktívne | interaktívne s UI permission promptom |
| Multi-session | Áno (tabbed) / Nie (single) | single v MVP, tabbed neskôr |

---

## Závislosti

### Plugin (npm)
- `obsidian` – Obsidian API typy
- `typescript` – kompilátor
- `esbuild` – bundler
- `@types/node` – Node.js typy pre child_process

### Daemon (npm, v `bridge/`)
- `@anthropic-ai/claude-agent-sdk` – ACP komunikácia s Claude Code

---

## MVP rozsah

Minimálna verzia, ktorá funguje:
1. Daemon spustí sa a odpovie na `claude.send`
2. Plugin zobrazí chat panel v Obsidiane
3. User napíše správu → dostane streamovanú odpoveď
4. Tool use sa zobrazí collapsible
5. Abort funguje
6. Settings: cwd, model, sendKey

Neskôr (post-MVP):
- Session história
- Permission UI (interaktívne schvaľovanie)
- Multi-session / tabbed view
- Export chatu ako Obsidian note
- File tagging (@file.md)
