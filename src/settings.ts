import { App, PluginSettingTab, Setting } from 'obsidian';
import type ClaudeChatPlugin from './main';
import type { SendKey, PermissionMode } from './types';

export class ClaudeChatSettingTab extends PluginSettingTab {
  plugin: ClaudeChatPlugin;

  constructor(app: App, plugin: ClaudeChatPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Working directory')
      .setDesc('Absolute path passed as cwd to Claude Code. Leave empty to use the vault root.')
      .addText((t) =>
        t
          .setPlaceholder('/home/user/myproject')
          .setValue(this.plugin.settings.cwd)
          .onChange(async (v) => {
            this.plugin.settings.cwd = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Claude model ID (e.g. claude-sonnet-4-6). Leave empty to use the SDK default.')
      .addText((t) =>
        t
          .setPlaceholder('claude-sonnet-4-6')
          .setValue(this.plugin.settings.model)
          .onChange(async (v) => {
            this.plugin.settings.model = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Send key')
      .setDesc('Keyboard shortcut to send a message.')
      .addDropdown((d) =>
        d
          .addOption('ctrl+enter', 'Ctrl + Enter')
          .addOption('enter', 'Enter')
          .setValue(this.plugin.settings.sendKey)
          .onChange(async (v) => {
            this.plugin.settings.sendKey = v as SendKey;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Permission mode')
      .setDesc('Controls how Claude Code handles tool permissions.')
      .addDropdown((d) =>
        d
          .addOption('default', 'Default (ask for each action)')
          .addOption('acceptEdits', 'Accept edits automatically')
          .addOption('bypassPermissions', 'Bypass all permissions')
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (v) => {
            this.plugin.settings.permissionMode = v as PermissionMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Node.js path')
      .setDesc('Absolute path to the node binary. Leave empty to auto-detect (e.g. /usr/bin/node).')
      .addText((t) =>
        t
          .setPlaceholder('/usr/bin/node')
          .setValue(this.plugin.settings.nodePath)
          .onChange(async (v) => {
            this.plugin.settings.nodePath = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Projects folder')
      .setDesc('Vault subfolder containing project directories. Each subdirectory becomes a project.')
      .addText((t) =>
        t
          .setPlaceholder('projects')
          .setValue(this.plugin.settings.projectsFolder)
          .onChange(async (v) => {
            this.plugin.settings.projectsFolder = v.trim() || 'projects';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Rules path')
      .setDesc('Folder name containing rules files (.md). Loaded from vault root and project directory.')
      .addText((t) =>
        t
          .setPlaceholder('x-ai-rules')
          .setValue(this.plugin.settings.rulesPath)
          .onChange(async (v) => {
            this.plugin.settings.rulesPath = v.trim() || 'x-ai-rules';
            await this.plugin.saveSettings();
          })
      );
  }
}
