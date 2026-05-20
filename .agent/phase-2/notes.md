# Fáza 2 – IPC Layer

## Vytvorené súbory
- `src/types.ts` – všetky zdieľané TypeScript typy
- `src/ipc.ts` – `DaemonBridge` trieda

## DaemonBridge API

```typescript
const bridge = new DaemonBridge('/path/to/bridge/daemon.js');
await bridge.start();   // spawn, čaká na 'ready' event

// Odoslanie správy
const reqId = bridge.send(params, { onLine, onDone });

// Prerušenie
bridge.abort(clientKey?);

// Vypnutie
bridge.stop();

// Events
bridge.on('ready', () => {});
bridge.on('exit', (code) => {});
bridge.on('stderr', (text) => {});
bridge.on('heartbeat-timeout', () => {});
```

## Kľúčové rozhodnutia

### Callback-based (nie Promise)
- `send()` vracia `reqId` a akceptuje `{ onLine, onDone }` callbacky
- Dôvod: streaming – chceme reagovať na každý riadok, nie čakať na koniec

### Pending Map
- `Map<reqId, callbacks>` pre demuxing odpovedí podľa request ID
- Rovnaký vzor ako JetBrains DaemonBridge.java

### Heartbeat
- Každých 15 s pošle `heartbeat` na stdin
- Ak 45 s bez odpovede, emituje `heartbeat-timeout`

## Typy (src/types.ts)

```
DaemonEvent | DaemonLine | DaemonDone | DaemonHeartbeat  ← daemon protokol
ContentBlockText | ContentBlockToolUse | ContentBlockToolResult  ← SDK správy
ChatMessage | ChatSession  ← UI stav
ClaudeChatSettings + DEFAULT_SETTINGS  ← nastavenia
```
