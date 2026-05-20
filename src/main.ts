import { Plugin, WorkspaceLeaf } from 'obsidian';
import { join } from 'path';
import { existsSync } from 'fs';
import { ClaudeChatView, VIEW_TYPE } from './view';
import { ClaudeChatSettingTab } from './settings';
import { DaemonBridge } from './ipc';
import { DEFAULT_SETTINGS, type ClaudeChatSettings } from './types';

// Obsidian's FileSystemAdapter (desktop only) is not exported in types,
// so we declare the subset of its API we rely on.
interface FileSystemAdapter {
	getBasePath(): string;
}

export default class ClaudeChatPlugin extends Plugin {
  settings: ClaudeChatSettings = { ...DEFAULT_SETTINGS };
  bridge: DaemonBridge | null = null;

  private bridgeReady = false;
  private bridgeError: string | null = null;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new ClaudeChatView(leaf, this));

    this.addRibbonIcon('message-square', 'Claude Code Chat', () => this.activateView());

    this.addCommand({
      id: 'open-claude-chat',
      name: 'Open Claude Code Chat',
      callback: () => this.activateView(),
    });

    this.addSettingTab(new ClaudeChatSettingTab(this.app, this));

    // Start daemon in background – don't block plugin load
    this.startDaemon().catch((err) => {
      console.error('[claude-chat] daemon start failed:', err);
      this.bridgeError = err.message;
    });
  }

  onunload() {
    this.bridge?.stop();
    this.bridge = null;
    this.bridgeReady = false;
  }

  // ── Settings ────────────────────────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── Daemon lifecycle ─────────────────────────────────────────────────────────

  private async startDaemon() {
    if (existsSync('/.flatpak-info')) {
      throw new Error(
        'Tento plugin nepodporuje Obsidian nainštalovaný ako Flatpak.\n' +
        'Nainštaluj verziu .deb alebo AppImage z obsidian.md/download.'
      );
    }

    const daemonPath = this.getDaemonPath();

    this.bridge = new DaemonBridge(daemonPath, this.settings.nodePath);

    this.bridge.on('ready', () => {
      this.bridgeReady = true;
      this.bridgeError = null;
      // Notify all open chat views
      this.emitToViews('daemon-ready');
    });

    this.bridge.on('exit', (code: number) => {
      this.bridgeReady = false;
      this.emitToViews('daemon-exit', code);
    });

    this.bridge.on('stderr', (text: string) => {
      console.debug('[claude-chat daemon]', text);
    });

    this.bridge.on('heartbeat-timeout', () => {
      console.warn('[claude-chat] daemon heartbeat timeout');
    });

    await this.bridge.start();
  }

  /** Resolve absolute path to bridge/daemon.js relative to this plugin. */
  private getDaemonPath(): string {
    const adapter = this.app.vault.adapter as unknown as FileSystemAdapter;
    const pluginDir = join(adapter.getBasePath(), this.manifest.dir ?? '');
    return join(pluginDir, 'bridge', 'daemon.js');
  }

  // ── Effective CWD for Claude Code ────────────────────────────────────────────

  getEffectiveCwd(): string {
    if (this.settings.cwd) return this.settings.cwd;
    return (this.app.vault.adapter as unknown as FileSystemAdapter).getBasePath();
  }

  // ── Project support ───────────────────────────────────────────────────────────

  getProjectsRoot(): string {
    const base = (this.app.vault.adapter as unknown as FileSystemAdapter).getBasePath();
    return join(base, this.settings.projectsFolder || 'projects');
  }

  async listProjects(): Promise<string[]> {
    const folder = this.settings.projectsFolder || 'projects';
    try {
      const result = await (this.app.vault.adapter as unknown as {
        list(path: string): Promise<{ folders: string[] }>;
      }).list(folder);
      return result.folders
        .map((f) => f.split('/').pop() ?? f)
        .filter(Boolean)
        .sort();
    } catch {
      return [];
    }
  }

  /** Load and concatenate all .md rules files.
   *  Always reads vault-level rules; if projectAbsPath is given, also reads project-level rules. */
  async loadRulesText(projectAbsPath?: string): Promise<string> {
    const adapter = this.app.vault.adapter as unknown as {
      list(path: string): Promise<{ files: string[] }>;
      read(path: string): Promise<string>;
      exists(path: string): Promise<boolean>;
    };
    const rulesFolder = this.settings.rulesPath || 'x-ai-rules';
    const base = (this.app.vault.adapter as unknown as FileSystemAdapter).getBasePath();

    const readFolder = async (vaultRelPath: string): Promise<string> => {
      try {
        const { files } = await adapter.list(vaultRelPath);
        const mdFiles = files.filter((f) => f.endsWith('.md')).sort();
        const parts = await Promise.all(mdFiles.map((f) => adapter.read(f)));
        return parts.join('\n\n');
      } catch {
        return '';
      }
    };

    const sections: string[] = [];

    // Top-level vault rules
    const topText = await readFolder(rulesFolder);
    if (topText.trim()) sections.push(`# Vault rules (${rulesFolder})\n\n${topText.trim()}`);

    // Project-level rules (if project is active)
    if (projectAbsPath) {
      const projectFolder = projectAbsPath.replace(base + '/', '');
      const projectRulesPath = `${projectFolder}/${rulesFolder}`;
      const projectText = await readFolder(projectRulesPath);
      if (projectText.trim()) sections.push(`# Project rules (${projectRulesPath})\n\n${projectText.trim()}`);
    }

    return sections.join('\n\n---\n\n');
  }

  // ── View helpers ─────────────────────────────────────────────────────────────

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;

    const existing = workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) {
      leaf = existing[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE, active: true });
    }

    if (leaf) workspace.revealLeaf(leaf);
  }

  isDaemonReady(): boolean {
    return this.bridgeReady;
  }

  getDaemonError(): string | null {
    return this.bridgeError;
  }

  private emitToViews(event: string, ...args: unknown[]) {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      (leaf.view as ClaudeChatView).onBridgeEvent(event, ...args);
    });
  }
}
