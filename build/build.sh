#!/usr/bin/env bash
# =============================================================================
# Claude Code Chat – Release Script
# =============================================================================
# Compiles TypeScript → main.js via esbuild, then packages into a ZIP for
# distribution as an Obsidian plugin.
#
# Usage:
#   ./build/build.sh                   # build + ZIP with version from manifest
#   ./build/build.sh --version 0.2.0   # override version in ZIP name only
#   ./build/build.sh --out /tmp/dist   # custom output directory for ZIP
#   ./build/build.sh --install         # build + install directly into vault
#   ./build/build.sh --no-zip          # build only, skip ZIP packaging
#
# Output:
#   build/dist/main.js                       (compiled JS – always created)
#   build/dist/claude-chat-v<version>.zip    (unless --no-zip)
#       claude-chat/
#           manifest.json
#           main.js
#           styles.css
#           bridge/
#               daemon.js
#               async-stream.js
#               package.json
#               node_modules/
#
# Requirements:
#   node >= 18, npm dependencies installed (npm install && cd bridge && npm install)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$REPO_ROOT/src"
BRIDGE_DIR="$REPO_ROOT/bridge"
DIST_DIR="$SCRIPT_DIR/dist"
OUT_DIR="$DIST_DIR"
VAULT_PATH="${OBSIDIAN_VAULT_PATH:-$HOME/obsidian/claude}"
PLUGIN_ID="claude-chat"

VERSION=""
INSTALL=false
NO_ZIP=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --out)     OUT_DIR="$2"; shift 2 ;;
        --install) INSTALL=true; shift ;;
        --no-zip)  NO_ZIP=true; shift ;;
        -h|--help) sed -n '3,22p' "$0"; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

# ── Resolve version from manifest ─────────────────────────────────────────────

if [[ -z "$VERSION" ]]; then
    if command -v node &>/dev/null; then
        VERSION="$(node -e "process.stdout.write(require('$SRC_DIR/manifest.json').version)")"
    elif command -v jq &>/dev/null; then
        VERSION="$(jq -r '.version' "$SRC_DIR/manifest.json")"
    else
        VERSION="$(python3 -c "import json; print(json.load(open('$SRC_DIR/manifest.json'))['version'], end='')")"
    fi
fi

echo "=== Claude Code Chat Release ==="
echo "Version : $VERSION"
echo "Source  : $SRC_DIR"
echo "Dist    : $DIST_DIR"
echo ""

# ── Install npm deps if needed ────────────────────────────────────────────────

if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    echo "Installing plugin npm dependencies…"
    npm install --prefix "$REPO_ROOT"
    echo ""
fi

if [[ ! -d "$BRIDGE_DIR/node_modules" ]]; then
    echo "Installing bridge npm dependencies…"
    npm install --prefix "$BRIDGE_DIR"
    echo ""
fi

# ── Compile TypeScript → JS via esbuild ──────────────────────────────────────

mkdir -p "$DIST_DIR"
echo "Compiling TypeScript…"
node "$SCRIPT_DIR/esbuild.mjs"
echo ""

# ── Sync manifest.json to repo root (required for Obsidian Community Plugins) ─

cp "$SRC_DIR/manifest.json" "$REPO_ROOT/manifest.json"

# ── Package ZIP ───────────────────────────────────────────────────────────────

if [[ "$NO_ZIP" == "false" ]]; then
    ZIP_NAME="${PLUGIN_ID}-v${VERSION}.zip"
    ZIP_PATH="$OUT_DIR/$ZIP_NAME"
    mkdir -p "$OUT_DIR"

    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT

    mkdir -p "$TMP_DIR/$PLUGIN_ID"
    cp "$DIST_DIR/main.js"      "$TMP_DIR/$PLUGIN_ID/main.js"
    cp "$SRC_DIR/styles.css"    "$TMP_DIR/$PLUGIN_ID/styles.css"
    cp "$SRC_DIR/manifest.json" "$TMP_DIR/$PLUGIN_ID/manifest.json"

    # Include bridge/ (daemon + node_modules with SDK)
    if [[ -d "$BRIDGE_DIR" ]]; then
        cp -r "$BRIDGE_DIR" "$TMP_DIR/$PLUGIN_ID/bridge"
    fi

    rm -f "$ZIP_PATH"
    (cd "$TMP_DIR" && zip -r "$ZIP_PATH" "$PLUGIN_ID/")

    echo "Package : $ZIP_PATH"
    echo "Size    : $(du -sh "$ZIP_PATH" | cut -f1)"
    echo ""
fi

# ── Optional: install into vault ─────────────────────────────────────────────

if [[ "$INSTALL" == "true" ]]; then
    echo "Installing into vault…"
    OBSIDIAN_VAULT_PATH="$VAULT_PATH" node "$SCRIPT_DIR/install.mjs"
fi

echo "Done."
