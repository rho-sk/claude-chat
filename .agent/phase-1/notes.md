# Fáza 1 – ACP Bridge Daemon

## Vytvorené súbory
- `bridge/package.json` – ESM modul, závislosť `@anthropic-ai/claude-agent-sdk`
- `bridge/async-stream.js` – AsyncStream (rovnaký vzor ako JetBrains)
- `bridge/daemon.js` – hlavný daemon

## Protokol (daemon.js)

### Stdin (Plugin → Daemon)
```json
{"id":"1","method":"claude.send","params":{"clientKey":"uuid","message":"...","cwd":"/vault","sessionId":"","permissionMode":"default","model":"claude-sonnet-4-6"}}
{"id":"2","method":"claude.abort","params":{"clientKey":"uuid"}}
{"id":"3","method":"heartbeat"}
{"id":"4","method":"shutdown"}
```

### Stdout (Daemon → Plugin)
```
{"type":"daemon","event":"ready","pid":123}
{"id":"1","line":"[STREAM_START]"}
{"id":"1","line":"[SESSION_ID] abc123"}
{"id":"1","line":"[ASSISTANT] {\"type\":\"assistant\",\"message\":{\"content\":[...]}}"}
{"id":"1","line":"[STREAM_END]"}
{"id":"1","line":"[DONE] {\"sessionId\":\"abc123\"}"}
{"id":"1","done":true,"success":true}
```

## Kľúčové rozhodnutia

### `clientKey` ako session tracking kľúč
- Plugin generuje UUID per chat okno
- Daemon mapuje `clientKey → runtime` (inputStream + query iterátor)
- Runtime zostáva živý medzi správami v rovnakom chate
- Keď AI vráti reálny `session_id`, plugin ho uchová pre prípadné obnovenie po reštarte

### Bez streaming mode (MVP)
- Plné `[ASSISTANT]` správy, nie delty
- Jednoduchšia implementácia View

### SDK API (zistené z JetBrains kódu)
```javascript
import { query } from '@anthropic-ai/claude-agent-sdk';
const q = query({ prompt: asyncIterable, options: { cwd, permissionMode, model, maxTurns, systemPrompt } });
// q je AsyncIterator s hodnotami: { type: 'system'|'assistant'|'result', ... }
// system → session_id
// assistant → message.content[]
// result → koniec turnu
```

## Inštalácia
```bash
cd bridge && npm install
```
