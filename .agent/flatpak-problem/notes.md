# Flatpak – problém so spúšťaním subprocesov

## Situácia

Obsidian je nainštalovaný ako **Flatpak** (`md.obsidian.Obsidian`).
Beží v bwrap sandboxe – izolovaný filesystem namespace bez prístupu
k hostiteľskému `/usr/bin/node`.

```
bwrap sandbox
  └── /app/obsidian
       └── plugin: spawn('node', ['daemon.js'])
                   → ENOENT  (node nie je v sandboxe)
```

## Aktuálne (dirty) riešenie

### Čo sme urobili

```bash
flatpak override --user --allow=devel md.obsidian.Obsidian
flatpak override --user --talk-name=org.freedesktop.Flatpak md.obsidian.Obsidian
```

Plugin v `ipc.ts` detekuje Flatpak cez `existsSync('/.flatpak-info')` a namiesto
priameho `spawn('node', ...)` volá:

```typescript
spawn('/usr/bin/flatpak-spawn', ['--host', 'node', daemonPath])
```

`flatpak-spawn --host` spustí `node daemon.js` na **hoste** (mimo sandboxu)
cez D-Bus službu `org.freedesktop.Flatpak`.

### Prečo je to nebezpečné

| Permission | Čo umožňuje |
|---|---|
| `features=devel` | `ptrace()` – každý plugin môže debugovať / injektovať kód do ľubovoľného procesu usera |
| `talk-name=org.freedesktop.Flatpak` | Každý plugin môže volať `flatpak-spawn --host <ľubovoľný príkaz>` – **kompletný únik zo sandboxu** |

Výsledok: Flatpak sandbox pre Obsidian je **efektívne zrušený**.
Akýkoľvek (aj malicious) Obsidian plugin môže spustiť čokoľvek na hoste.

### Prečo sme to takto urobili

Rýchle riešenie na overenie že zvyšok architektúry (daemon, ACP SDK,
komunikácia cez NDJSON) funguje správne. Funguje, ale nie je produkčne
bezpečné.

## Prečo TCP server nie je dobré riešenie

Claude Code (claude-agent-sdk) nie je navrhnutý ako web služba –
na rozdiel od opencode ktorý má `opencode web --port XXXX` mód.
SDK je stavané na subprocess / embedded použitie, nie na HTTP server.
Pridanie TCP servera by znamenalo netriviálnu custom implementáciu
session managementu, autentifikácie soketu, atď.

## Čo treba preskúmať

Hľadáme riešenie ktoré:
1. Nepotrebuje `talk-name=org.freedesktop.Flatpak` ani `features=devel`
2. Nevyžaduje manuálne spúšťanie externej služby
3. Umožňuje spustiť Node.js process mimo Flatpak sandboxu
4. Ideálne: zero-config pre usera

Kandidáti na preskúmanie (výsledky z webu):
- → pozri research.md
