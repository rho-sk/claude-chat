# Fáza 4 – Chat View

## Vytvorený súbor
- `src/view.ts` – `ClaudeChatView extends ItemView`

## UI štruktúra (DOM)
```
.cc-root
  .cc-toolbar
    .cc-title
    button.cc-btn-icon  (nový chat)
  .cc-status           (stav daemona / "Claude is thinking…")
  .cc-messages         (scrollovateľný zoznam správ)
    .cc-msg.cc-msg--user      (user správa)
    .cc-msg.cc-msg--assistant (assistant správa)
      .cc-text-block          (text → MarkdownRenderer)
      .cc-tool-block          (tool_use → collapsible)
  .cc-input-area
    textarea.cc-input
    .cc-input-actions
      button.cc-send-btn
```

## Streaming pipeline

```
handleSend()
  → bridge.send(params, { onLine, onDone })
  ↓
handleDaemonLine(line):
  '[STREAM_START]'  → ignoruj (spinner je viditeľný)
  '[SESSION_ID] x'  → session.sessionId = x
  '[ASSISTANT] {...}' → parsuj AssistantMessage, pridaj bloky do pendingBlocks
  '[STREAM_END]'    → flushPendingMessage() → render do DOM
  '[DONE] {...}'    → ignoruj (session ID už máme)
  ↓
handleTurnDone(success, error)
  → setBusy(false)
  → showError() ak neúspech
```

## Rendering

| Blok | Rendering |
|------|-----------|
| `text` | `MarkdownRenderer.render()` do `.cc-text-block` |
| `tool_use` | `.cc-tool-block` s collapsible body (JSON input) |
| `tool_result` | ignorovaný v MVP (príde ako súčasť tool_use toku) |

## Session tracking
- `clientKey`: UUID generovaný pri otvorení view (alebo "New chat")
- `sessionId`: prázdny na začiatku, nastavený z `[SESSION_ID]` linky
- Pri "New chat": nový `clientKey` + `sessionId = ''` → nová konverzácia
