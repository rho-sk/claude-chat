# Claude Code Chat – Obsidian Plugin

Chat with Claude Code directly inside your Obsidian vault.
Uses the official `@anthropic-ai/claude-agent-sdk` (ACP protocol) – no external server needed.

## Features

- **Live streaming** – text streams token by token as Claude thinks
- **Tool visibility** – see every tool call (bash, read, write…) inline with allow/deny
- **Permission dialog** – interactive allow/deny for each tool in Default mode
- **AskUserQuestion** – native question UI with option buttons
- **Plan mode** – Claude plans without executing; approve or request changes inline
- **Project & session management** – vault `projects/` folder → per-project sessions with history
- **Rules injection** – load vault/project rules into any session on demand
- **Model & reasoning selector** – switch model, thinking budget, 1M context per message

## Requirements

- Obsidian desktop (Linux / macOS / Windows)
- **Not supported**: Obsidian installed as Flatpak (sandbox prevents spawning Node.js)
- Node.js installed on the host system (≥ 18)
- Claude Code credentials configured (`claude login` or `ANTHROPIC_API_KEY`)

## Installation

### Option 1 – Manual install (ZIP)

1. Go to the [Releases page](https://github.com/rho-sk/claude-chat/releases/latest)
2. Download `claude-chat-v*.zip`
3. Extract into your vault's plugins folder:

```bash
unzip claude-chat-v*.zip -d /path/to/vault/.obsidian/plugins/
```

4. In Obsidian: **Settings → Community plugins → Enable "Claude Code Chat"**

### Option 2 – Build from source

```bash
git clone https://github.com/rho-sk/claude-chat
cd claude-chat
npm install
cd bridge && npm install && cd ..
./build/build.sh --install   # builds + copies to ~/work/obsidian/claude
```

See [Build](#build) section for full options.

## Repository structure

```
claude-chat/
├── src/
│   ├── main.ts          # Plugin entry point
│   ├── view.ts          # Chat UI (ItemView)
│   ├── ipc.ts           # Daemon bridge (spawn + NDJSON)
│   ├── settings.ts      # Settings tab
│   ├── types.ts         # Shared types
│   ├── styles.css
│   └── manifest.json
├── bridge/
│   ├── daemon.js        # Long-running Node.js ACP bridge
│   ├── async-stream.js
│   └── package.json     # { @anthropic-ai/claude-agent-sdk }
├── build/
│   ├── build.sh         # Build + package + install
│   ├── esbuild.mjs      # TS → CJS bundle
│   └── install.mjs      # Copy to vault
├── package.json
├── tsconfig.json
└── versions.json        # Obsidian Community Plugin compatibility map
```

## Build

```bash
# Build ZIP (version from src/manifest.json)
./build/build.sh

# Build + install directly into vault
./build/build.sh --install

# Custom vault path (default: ~/work/obsidian/claude)
OBSIDIAN_VAULT_PATH=/path/to/vault ./build/build.sh --install
```

Output: `build/dist/claude-chat-v<version>.zip`

## Architecture

```
Obsidian Plugin (Electron / Node.js)
  └── DaemonBridge – spawn + stdin/stdout NDJSON
       └── bridge/daemon.js (Node.js)
            └── @anthropic-ai/claude-agent-sdk
                 └── claude binary (ACP)
```

- **Plugin** (`src/`) – Obsidian ItemView, keyboard scope, streaming renderer
- **Daemon** (`bridge/daemon.js`) – long-running process, holds SDK sessions, handles `canUseTool` / `AskUserQuestion` / plan mode
- **IPC** – NDJSON over stdin/stdout; SDK messages forwarded as-is by type

## Plugin settings

| Setting | Default | Description |
|---|---|---|
| Working directory | vault root | CWD for Claude Code |
| Model | SDK default | Claude model ID |
| Send key | `Ctrl+Enter` | Keyboard shortcut |
| Permission mode | Default | Tool permission behavior |
| Node.js path | auto-detect | Absolute path to `node` binary |
| Projects folder | `projects` | Vault subfolder with project dirs |
| Rules path | `x-ai-rules` | Folder name containing `.md` rules files |

## Version

Current version: see `src/manifest.json`.
