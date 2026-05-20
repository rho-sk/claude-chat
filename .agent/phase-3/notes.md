# Fáza 3 – Plugin kostra

## Vytvorené súbory
- `src/settings.ts` – `ClaudeChatSettingTab`
- `src/main.ts` – `ClaudeChatPlugin` (hlavná trieda)

## Settings (src/settings.ts)

4 nastavenia:
| Kľúč | Typ | Default | Popis |
|------|-----|---------|-------|
| `cwd` | string | '' | CWD pre Claude Code (prázdne = vault root) |
| `model` | string | '' | Model ID (prázdne = SDK default) |
| `sendKey` | `'ctrl+enter'` \| `'enter'` | `'ctrl+enter'` | Klávesová skratka |
| `permissionMode` | `'default'` \| `'acceptEdits'` \| `'bypassPermissions'` | `'default'` | Oprávnenia |

## Plugin (src/main.ts)

### Lifecycle
- `onload()` → načítaj nastavenia → registruj view → spusti daemon v pozadí
- `onunload()` → `bridge.stop()`

### getDaemonPath()
- Použije `FileSystemAdapter.getBasePath()` (Electron desktop API)
- Zostaví: `[vaultBase]/[manifest.dir]/bridge/daemon.js`

### getEffectiveCwd()
- Ak user nastavil `settings.cwd`, použije ho
- Inak: vault root

### emitToViews()
- Notifikuje všetky otvorené `ClaudeChatView` o bridge eventoch
