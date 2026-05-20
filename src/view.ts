import { ItemView, MarkdownRenderer, Modal, Notice, Scope, WorkspaceLeaf } from 'obsidian';
import { randomUUID } from 'crypto';
import { join } from 'path';
import type ClaudeChatPlugin from './main';
import type {
  ChatMessage,
  ChatSession,
  ContentBlock,
  ContentBlockText,
  ContentBlockToolUse,
  SDKMessage,
  SDKAssistantMessage,
  SDKStreamEvent,
  SDKSystemMessage,
  PermissionMode,
  PermissionRequestPayload,
  QuestionRequestPayload,
  QuestionDef,
  ThinkingConfig,
  SessionInfo,
  SessionMessage,
} from './types';

export const VIEW_TYPE = 'claude-chat';

export class ClaudeChatView extends ItemView {
  private plugin: ClaudeChatPlugin;
  private session: ChatSession;
  private messages: ChatMessage[] = [];

  // DOM
  private messagesEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private modeSelect!: HTMLSelectElement;
  private modelSelect!: HTMLSelectElement;
  private thinkingSelect!: HTMLSelectElement;
  private contextBtn!: HTMLButtonElement;
  private rulesBtn!: HTMLButtonElement;
  private projectSelect!: HTMLSelectElement;
  private sessionSelect!: HTMLSelectElement;
  private activeProjectPath: string | null = null;

  // Keyboard scope
  private textareaScope: Scope | null = null;

  // State
  private busy = false;
  private extendedContext = false;
  private lastSentInPlanMode = false;

  // Streaming
  private pendingBlocks: ContentBlock[] = [];
  private pendingMsgEl: HTMLElement | null = null;
  private pendingContentEl: HTMLElement | null = null;
  private streamingIndicatorEl: HTMLElement | null = null;
  private streamingTextEl: HTMLElement | null = null;
  private streamText = '';

  constructor(leaf: WorkspaceLeaf, plugin: ClaudeChatPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.session = { clientKey: randomUUID(), sessionId: '' };
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Claude Code Chat'; }
  getIcon() { return 'message-square'; }

  async onOpen() {
    this.buildUI();
    this.updateStatus();
    void this.refreshProjectList();
    if (this.plugin.isDaemonReady()) {
      void this.refreshSessionList();
    }
  }
  async onClose() { this.popTextareaScope(); }

  onBridgeEvent(event: string, ...args: unknown[]) {
    if (event === 'daemon-ready') {
      this.updateStatus();
      void this.refreshProjectList();
      void this.refreshSessionList();
    }
    if (event === 'daemon-exit') this.updateStatus(`Daemon exited (code ${args[0]})`);
  }

  // ── Keyboard scope ───────────────────────────────────────────────────────────

  private pushTextareaScope() {
    if (this.textareaScope) return;
    this.textareaScope = new Scope(this.app.scope);
    this.textareaScope.register(['Ctrl'], 'Enter', () => {
      if (this.plugin.settings.sendKey === 'ctrl+enter') { void this.handleSend(); return false; }
    });
    this.textareaScope.register(['Meta'], 'Enter', () => {
      if (this.plugin.settings.sendKey === 'ctrl+enter') { void this.handleSend(); return false; }
    });
    this.app.keymap.pushScope(this.textareaScope);
  }

  private popTextareaScope() {
    if (!this.textareaScope) return;
    this.app.keymap.popScope(this.textareaScope);
    this.textareaScope = null;
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

  private buildUI() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('cc-root');

    const toolbar = root.createEl('div', { cls: 'cc-toolbar' });
    toolbar.createEl('span', { cls: 'cc-title', text: 'Claude Code Chat' });

    // Project picker – refresh list on focus so new folders appear immediately
    this.projectSelect = toolbar.createEl('select', { cls: 'cc-select cc-project-select' });
    this.projectSelect.createEl('option', { text: '— project —', value: '' });
    this.projectSelect.addEventListener('focus', () => { void this.refreshProjectList(); });
    this.projectSelect.addEventListener('change', () => { void this.onProjectChange(); });

    // Session picker
    this.sessionSelect = toolbar.createEl('select', { cls: 'cc-select cc-session-select' });
    this.sessionSelect.createEl('option', { text: 'New chat', value: '' });
    this.sessionSelect.addEventListener('change', () => {
      const sid = this.sessionSelect.value;
      if (sid) void this.loadSession(sid);
      else this.newChat();
    });

    // Delete session button
    const deleteBtn = toolbar.createEl('button', { cls: 'cc-btn-icon', title: 'Delete current session' });
    deleteBtn.innerHTML = '🗑';
    deleteBtn.addEventListener('click', () => { void this.confirmDeleteSession(); });

    const newBtn = toolbar.createEl('button', { cls: 'cc-btn-icon', title: 'New chat' });
    newBtn.innerHTML = '＋';
    newBtn.addEventListener('click', () => { this.newChat(); this.sessionSelect.value = ''; });

    this.statusEl = root.createEl('div', { cls: 'cc-status' });
    this.messagesEl = root.createEl('div', { cls: 'cc-messages' });
    this.actionsEl = root.createEl('div', { cls: 'cc-actions' });

    const inputArea = root.createEl('div', { cls: 'cc-input-area' });

    // Resize handle
    const resizeHandle = inputArea.createEl('div', { cls: 'cc-resize-handle' });
    this.addResizeHandle(resizeHandle, inputArea);

    // Row 1: textarea + send/cancel buttons
    const inputRow = inputArea.createEl('div', { cls: 'cc-input-row' });

    this.inputEl = inputRow.createEl('textarea', {
      cls: 'cc-input',
      attr: { placeholder: this.sendPlaceholder(), rows: '3' },
    });
    this.inputEl.addEventListener('input', () => this.growTextarea());
    this.inputEl.addEventListener('focus', () => this.pushTextareaScope());
    this.inputEl.addEventListener('blur',  () => this.popTextareaScope());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.plugin.settings.sendKey === 'enter'
          && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });

    const btnCol = inputRow.createEl('div', { cls: 'cc-btn-col' });

    this.cancelBtn = btnCol.createEl('button', { cls: 'cc-cancel-btn', attr: { title: 'Stop' } });
    this.cancelBtn.innerHTML = '✕';
    this.cancelBtn.addEventListener('click', () => {
      this.plugin.bridge?.abort(this.session.clientKey);
    });

    this.sendBtn = btnCol.createEl('button', { cls: 'cc-send-btn', attr: { title: 'Send' } });
    this.sendBtn.innerHTML = '↑';
    this.sendBtn.addEventListener('click', () => { void this.handleSend(); });

    // Row 2: mode / model / thinking / 1M controls
    const bottomBar = inputArea.createEl('div', { cls: 'cc-bottom-bar' });

    this.modeSelect = bottomBar.createEl('select', { cls: 'cc-select' });
    [
      ['default',            'Default'],
      ['bypassPermissions',  'Agent'],
      ['plan',               'Plan'],
      ['auto',               'Auto'],
    ].forEach(([v, l]) => {
      const o = this.modeSelect.createEl('option', { text: l });
      o.value = v;
    });
    this.modeSelect.value = this.plugin.settings.permissionMode !== 'plan'
      ? this.plugin.settings.permissionMode
      : 'auto';

    this.modelSelect = bottomBar.createEl('select', { cls: 'cc-select' });
    [
      ['',                             'claude-sonnet-4-6'],
      ['claude-opus-4-7',              'claude-opus-4-7'],
      ['claude-haiku-4-5-20251001',    'claude-haiku-4-5'],
    ].forEach(([v, l]) => {
      const o = this.modelSelect.createEl('option', { text: l });
      o.value = v;
    });
    this.modelSelect.value = this.plugin.settings.model ?? '';

    this.thinkingSelect = bottomBar.createEl('select', { cls: 'cc-select' });
    [
      ['',       'Thinking off'],
      ['low',    'Low'],
      ['medium', 'Medium'],
      ['high',   'High'],
      ['max',    'Max'],
    ].forEach(([v, l]) => {
      const o = this.thinkingSelect.createEl('option', { text: l });
      o.value = v;
    });

    this.contextBtn = bottomBar.createEl('button', {
      cls: 'cc-context-btn',
      text: '1M',
      attr: { title: 'Enable 1 million token context window (beta)' },
    });
    this.contextBtn.addEventListener('click', () => {
      this.extendedContext = !this.extendedContext;
      this.contextBtn.toggleClass('cc-context-btn--active', this.extendedContext);
    });

    this.rulesBtn = bottomBar.createEl('button', {
      cls: 'cc-rules-btn',
      text: 'Rules',
      attr: { title: 'Inject vault/project rules into current session now' },
    });
    this.rulesBtn.addEventListener('click', () => { void this.injectRules(); });

    const fontDecBtn = bottomBar.createEl('button', {
      cls: 'cc-font-btn',
      text: 'A−',
      attr: { title: 'Decrease font size' },
    });
    const fontIncBtn = bottomBar.createEl('button', {
      cls: 'cc-font-btn',
      text: 'A+',
      attr: { title: 'Increase font size' },
    });
    fontDecBtn.addEventListener('click', () => this.adjustFontSize(-1));
    fontIncBtn.addEventListener('click', () => this.adjustFontSize(+1));
    this.applyFontSize();

    this.setCancelVisible(false);
    this.updateStatus();
  }

  private buildThinkingConfig(): ThinkingConfig | undefined {
    switch (this.thinkingSelect.value) {
      case 'low':    return { type: 'enabled', budgetTokens: 2_000 };
      case 'medium': return { type: 'enabled', budgetTokens: 8_000 };
      case 'high':   return { type: 'enabled', budgetTokens: 16_000 };
      case 'max':    return { type: 'adaptive' };
      default:       return undefined;
    }
  }

  private sendPlaceholder() {
    return `Message… (${this.plugin.settings.sendKey === 'enter' ? 'Enter' : 'Ctrl+Enter'} = send)`;
  }

  private growTextarea() {
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = Math.min(320, Math.max(64, this.inputEl.scrollHeight)) + 'px';
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  private async handleSend() {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    if (!this.plugin.isDaemonReady()) {
      this.updateStatus('Daemon not ready – restart Obsidian');
      return;
    }

    this.inputEl.value = '';
    this.growTextarea();
    this.setBusy(true);
    this.appendUserMessage(text);

    this.pendingBlocks = [];
    this.pendingContentEl = null;
    this.streamingIndicatorEl = null;
    this.streamingTextEl = null;
    this.streamText = '';
    this.pendingMsgEl = this.messagesEl.createEl('div', { cls: 'cc-msg cc-msg--assistant cc-msg--streaming' });
    this.pendingMsgEl.createEl('div', { cls: 'cc-spinner' });
    this.scrollToBottom();

    const permissionMode = this.modeSelect.value as PermissionMode;
    const model = this.modelSelect.value || this.plugin.settings.model;
    const thinkingConfig = this.buildThinkingConfig();
    this.lastSentInPlanMode = permissionMode === 'plan';

    this.plugin.bridge!.send(
      {
        clientKey: this.session.clientKey,
        message: text,
        sessionId: this.session.sessionId,
        cwd: this.getEffectiveSendCwd(),
        model,
        permissionMode,
        thinkingConfig,
        extendedContext: this.extendedContext,
      },
      {
        onSdkMsg: (msg) => this.handleSdkMsg(msg),
        onPermissionRequest: (req) => this.showPermissionDialog(req),
        onQuestionRequest: (req) => this.showQuestionDialog(req),
        onDone: (ok, err) => this.handleTurnDone(ok, err),
      }
    );
  }

  // ── SDK message handling ─────────────────────────────────────────────────────

  private handleSdkMsg(msg: SDKMessage) {
    switch (msg.type) {

      case 'system': {
        const sys = msg as SDKSystemMessage;
        if (sys.session_id && sys.session_id !== this.session.sessionId) {
          this.session.sessionId = sys.session_id;
          // Pre-select this session in the dropdown as soon as we get its ID
          // (actual refresh with label happens in handleTurnDone)
          const existing = this.sessionSelect.querySelector<HTMLOptionElement>(`option[value="${sys.session_id}"]`);
          if (!existing) {
            const opt = this.sessionSelect.createEl('option', { text: '(current session)', value: sys.session_id });
            this.sessionSelect.value = opt.value;
          }
        }
        break;
      }

      case 'stream_event': {
        const ev = (msg as SDKStreamEvent).event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          this.appendStreamingText(ev.delta.text);
        }
        break;
      }

      case 'assistant': {
        const assistant = msg as SDKAssistantMessage;
        for (const block of assistant.message?.content ?? []) {
          if (block.type === 'tool_use') {
            this.pendingBlocks.push(block);
            this.streamToolBlock(block as ContentBlockToolUse);
          }
          // Text blocks already covered by stream_event deltas; skip to avoid duplication
        }
        this.scrollToBottom();
        break;
      }

      case 'result': {
        // Turn complete – finalize the streamed text into markdown
        this.finalizeStream();
        break;
      }
    }
  }

  // ── Stream rendering ─────────────────────────────────────────────────────────

  private ensureContentArea() {
    if (this.pendingContentEl || !this.pendingMsgEl) return;
    this.pendingMsgEl.empty();
    this.pendingMsgEl.removeClass('cc-msg--streaming');
    this.pendingContentEl = this.pendingMsgEl.createEl('div', { cls: 'cc-msg-blocks' });
    this.streamingIndicatorEl = this.pendingMsgEl.createEl('div', { cls: 'cc-streaming-indicator' });
    this.streamingIndicatorEl.createEl('span', { cls: 'cc-streaming-dot' });
  }

  private appendStreamingText(delta: string) {
    if (!this.pendingMsgEl) return;
    this.ensureContentArea();
    this.streamText += delta;
    if (!this.streamingTextEl) {
      this.streamingTextEl = this.pendingContentEl!.createEl('pre', { cls: 'cc-stream-pre' });
    }
    this.streamingTextEl.textContent = this.streamText;
    this.scrollToBottom();
  }

  private streamToolBlock(block: ContentBlockToolUse) {
    this.ensureContentArea();
    // Seal the active text segment so text after this tool block starts a new element below it
    this.sealTextSegment();
    this.renderToolBlock(block, this.pendingContentEl!);
    this.updateStatus(`Running: ${block.name}…`);
  }

  // Store current streamText into the active pre's dataset and clear the reference,
  // so the next text delta creates a fresh <pre> at the current DOM end position.
  private sealTextSegment() {
    if (!this.streamingTextEl) return;
    if (this.streamText) {
      this.streamingTextEl.dataset.text = this.streamText;
    } else {
      this.streamingTextEl.remove();
    }
    this.streamingTextEl = null;
    this.streamText = '';
  }

  private finalizeStream() {
    if (!this.pendingMsgEl) return;
    this.streamingIndicatorEl?.remove();
    this.streamingIndicatorEl = null;

    // Seal any still-active text segment
    this.sealTextSegment();

    // Replace every streaming <pre> (sealed segments) with rendered markdown in place
    if (this.pendingContentEl) {
      for (const pre of Array.from(
        this.pendingContentEl.querySelectorAll<HTMLElement>('pre.cc-stream-pre')
      )) {
        const text = pre.dataset.text ?? '';
        if (text) {
          const mdEl = document.createElement('div');
          mdEl.className = 'cc-text-block';
          pre.replaceWith(mdEl);
          void MarkdownRenderer.render(this.app, text, mdEl, '', this);
        } else {
          pre.remove();
        }
      }
    }

    if (!this.pendingContentEl) {
      this.pendingMsgEl.remove();
    }

    this.messages.push({
      id: randomUUID(), role: 'assistant',
      content: this.pendingBlocks, timestamp: Date.now(),
    });

    this.pendingMsgEl = null;
    this.pendingContentEl = null;
    this.pendingBlocks = [];
    this.streamText = '';
    this.scrollToBottom();
  }

  private handleTurnDone(success: boolean, error?: string) {
    if (!success && error) this.showError(error);
    this.finalizeStream();
    this.setBusy(false);
    if (success && this.lastSentInPlanMode) {
      this.showPlanApproval();
    }
    this.lastSentInPlanMode = false;
    this.scrollToBottom();
    void this.refreshSessionList();
  }

  private showPlanApproval() {
    const el = this.actionsEl.createEl('div', { cls: 'cc-plan-approval' });
    el.createEl('span', { cls: 'cc-plan-approval-label', text: 'Plan ready — approve to execute or request changes:' });

    const actions = el.createEl('div', { cls: 'cc-plan-approval-actions' });

    const approveBtn = actions.createEl('button', { cls: 'cc-plan-approve', text: 'Approve & Execute' });
    const changesBtn = actions.createEl('button', { cls: 'cc-plan-changes', text: 'Request changes' });

    const resolve = (action: 'approve' | 'changes') => {
      el.remove();
      if (action === 'approve') {
        this.modeSelect.value = 'default';
        this.inputEl.value = 'Plan approved. Please proceed with execution.';
        void this.handleSend();
      } else {
        this.inputEl.focus();
        this.inputEl.placeholder = 'Describe what to change in the plan…';
      }
    };

    approveBtn.addEventListener('click', () => resolve('approve'));
    changesBtn.addEventListener('click', () => resolve('changes'));
  }

  // ── Permission dialog ────────────────────────────────────────────────────────

  private showPermissionDialog(req: PermissionRequestPayload) {
    const el = this.actionsEl.createEl('div', { cls: 'cc-permission' });

    const header = el.createEl('div', { cls: 'cc-permission-header' });
    header.createEl('span', { cls: 'cc-permission-icon', text: '🔧' });
    header.createEl('span', { cls: 'cc-permission-tool', text: req.displayName ?? req.toolName });

    if (req.description) {
      el.createEl('div', { cls: 'cc-permission-desc', text: req.description });
    }

    const inputStr = JSON.stringify(req.input, null, 2);
    if (inputStr !== '{}') {
      const pre = el.createEl('pre', { cls: 'cc-permission-input' });
      pre.createEl('code', { text: inputStr });
    }

    const actions = el.createEl('div', { cls: 'cc-permission-actions' });

    const allow = actions.createEl('button', { cls: 'cc-perm-allow', text: 'Allow' });
    const deny  = actions.createEl('button', { cls: 'cc-perm-deny',  text: 'Deny' });

    const respond = (behavior: 'allow' | 'deny') => {
      allow.disabled = true;
      deny.disabled = true;
      el.createEl('span', { cls: 'cc-permission-verdict', text: behavior === 'allow' ? '✓ Allowed' : '✗ Denied' });
      this.plugin.bridge?.respondInteraction(req.interactionId, behavior);
      setTimeout(() => el.remove(), 1200);
    };

    allow.addEventListener('click', () => respond('allow'));
    deny.addEventListener('click',  () => respond('deny'));
  }

  // ── Question dialog (AskUserQuestion tool) ───────────────────────────────────

  private showQuestionDialog(req: QuestionRequestPayload) {
    const el = this.actionsEl.createEl('div', { cls: 'cc-question' });
    el.createEl('div', { cls: 'cc-question-title', text: '❓ Claude asks:' });

    // selectedAnswers[qi] = Set of selected labels for question qi
    const selected: Set<string>[] = req.questions.map(() => new Set());

    const questionEls = req.questions.map((q: QuestionDef, qi: number) => {
      const qEl = el.createEl('div', { cls: 'cc-question-item' });
      qEl.createEl('div', { cls: 'cc-question-text', text: q.question });

      const opts = qEl.createEl('div', { cls: 'cc-question-opts' });

      for (const opt of q.options) {
        const btn = opts.createEl('button', { cls: 'cc-question-opt', text: opt.label });
        if (opt.description) btn.title = opt.description;

        btn.addEventListener('click', () => {
          if (q.multiSelect) {
            // Toggle for multiSelect
            if (selected[qi].has(opt.label)) {
              selected[qi].delete(opt.label);
              btn.removeClass('cc-question-opt--selected');
            } else {
              selected[qi].add(opt.label);
              btn.addClass('cc-question-opt--selected');
            }
          } else {
            // Single select – deselect others
            selected[qi].clear();
            opts.querySelectorAll('.cc-question-opt').forEach((b) =>
              b.removeClass('cc-question-opt--selected')
            );
            selected[qi].add(opt.label);
            btn.addClass('cc-question-opt--selected');
          }
        });
      }

      return qEl;
    });

    const submitBtn = el.createEl('button', { cls: 'cc-question-submit', text: 'Submit' });
    submitBtn.addEventListener('click', () => {
      // Build answers as Record<questionText, string|string[]> – same format as JetBrains plugin
      const answers: Record<string, string | string[]> = {};
      req.questions.forEach((q: QuestionDef, qi: number) => {
        const labels = [...selected[qi]];
        if (labels.length > 0) {
          answers[q.question] = q.multiSelect ? labels : labels[0];
        }
      });

      el.querySelectorAll('button').forEach((b) => (b as HTMLButtonElement).disabled = true);

      const summary = req.questions.map((q: QuestionDef, i: number) => {
        const a = answers[q.question];
        const val = Array.isArray(a) ? a.join(', ') : (a ?? '—');
        return `${q.header ?? q.question}: ${val}`;
      }).join(' · ');
      el.createEl('div', { cls: 'cc-question-summary', text: summary });

      this.plugin.bridge?.respondQuestion(req.interactionId, answers);
      setTimeout(() => el.remove(), 1800);
    });

    // Keep a ref to suppress TS unused warning
    void questionEls;
  }

  // ── Message rendering ────────────────────────────────────────────────────────

  private appendUserMessage(text: string) {
    this.messages.push({ id: randomUUID(), role: 'user', content: text, timestamp: Date.now() });
    const el = this.messagesEl.createEl('div', { cls: 'cc-msg cc-msg--user' });
    el.createEl('div', { cls: 'cc-msg-content', text });
    this.scrollToBottom();
  }

  private renderTextBlock(block: ContentBlockText, container: HTMLElement) {
    const wrapper = container.createEl('div', { cls: 'cc-text-block' });
    void MarkdownRenderer.render(this.app, block.text, wrapper, '', this);
  }

  private renderToolBlock(block: ContentBlockToolUse, container: HTMLElement) {
    const wrapper = container.createEl('div', { cls: 'cc-tool-block' });
    const header = wrapper.createEl('div', { cls: 'cc-tool-header' });
    header.createEl('span', { cls: 'cc-tool-icon', text: '⚙' });
    header.createEl('span', { cls: 'cc-tool-name', text: block.name });
    const toggle = header.createEl('span', { cls: 'cc-tool-toggle', text: '▼' });

    const body = wrapper.createEl('div', { cls: 'cc-tool-body' });
    body.createEl('pre', { cls: 'cc-tool-input' })
      .createEl('code', { text: JSON.stringify(block.input, null, 2) });

    let open = false;
    header.addEventListener('click', () => {
      open = !open;
      body.toggleClass('cc-tool-body--open', open);
      toggle.textContent = open ? '▲' : '▼';
    });
  }

  private showError(msg: string) {
    if (!this.pendingMsgEl) return;
    this.pendingMsgEl.empty();
    this.pendingMsgEl.removeClass('cc-msg--streaming');
    this.pendingMsgEl.addClass('cc-msg--error');
    this.pendingMsgEl.createEl('div', { cls: 'cc-msg-content', text: `Error: ${msg}` });
    this.pendingMsgEl = null;
    this.pendingContentEl = null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private newChat() {
    if (this.busy) this.plugin.bridge?.abort(this.session.clientKey);
    this.session = { clientKey: randomUUID(), sessionId: '' };
    this.messages = [];
    this.pendingBlocks = [];
    this.pendingMsgEl = null;
    this.pendingContentEl = null;
    this.streamingIndicatorEl = null;
    this.streamingTextEl = null;
    this.streamText = '';
    this.setBusy(false);
    this.messagesEl.empty();
    this.actionsEl.empty();
    this.updateStatus();
    this.inputEl.focus();
  }

  private setBusy(v: boolean) {
    this.busy = v;
    this.sendBtn.disabled = v;
    this.inputEl.disabled = v;
    this.setCancelVisible(v);
    if (!v) this.inputEl.focus();
    this.updateStatus();
  }

  private setCancelVisible(v: boolean) { this.cancelBtn.style.display = v ? '' : 'none'; }

  private updateStatus(msg?: string) {
    if (msg) { this.statusEl.setText(msg); this.statusEl.removeClass('cc-status--error'); return; }
    this.statusEl.removeClass('cc-status--error');
    if (!this.plugin.isDaemonReady()) {
      const err = this.plugin.getDaemonError();
      if (err) { this.statusEl.addClass('cc-status--error'); this.statusEl.setText(`Daemon error: ${err}`); }
      else { this.statusEl.setText('Starting daemon…'); }
    } else if (this.busy) {
      this.statusEl.setText('Claude is thinking…');
    } else {
      this.statusEl.setText('');
    }
  }

  // ── Project + Session management ─────────────────────────────────────────────

  private async refreshProjectList() {
    const previous = this.projectSelect.value;
    const projects = await this.plugin.listProjects();
    this.projectSelect.empty();
    this.projectSelect.createEl('option', { text: '— project —', value: '' });
    for (const p of projects) {
      this.projectSelect.createEl('option', { text: p, value: p });
    }
    // Restore previous selection so the browser doesn't reset to '' and swallow change events
    if (previous) this.projectSelect.value = previous;
  }

  private async onProjectChange() {
    const name = this.projectSelect.value;
    this.activeProjectPath = name
      ? join(this.plugin.getProjectsRoot(), name)
      : null;
    this.newChat();
    this.sessionSelect.value = '';
    await this.refreshSessionList();
  }

  private async refreshSessionList() {
    // Reset immediately (synchronous) so the user sees the change at once
    this.sessionSelect.empty();
    this.sessionSelect.createEl('option', { text: 'New chat', value: '' });

    if (!this.plugin.bridge || !this.plugin.isDaemonReady()) return;

    try {
      const dir = this.activeProjectPath ?? this.plugin.getEffectiveCwd();
      const sessions = await this.plugin.bridge.listSessions(dir);
      for (const s of sessions) {
        const label = s.customTitle ?? s.summary ?? s.firstPrompt ?? s.sessionId.slice(0, 8);
        const date = new Date(s.lastModified).toLocaleDateString();
        const opt = this.sessionSelect.createEl('option', { text: `${label} (${date})`, value: s.sessionId });
        opt.title = s.firstPrompt ?? '';
      }
    } catch { /* silently ignore */ }
  }

  private async loadSession(sessionId: string) {
    if (!this.plugin.bridge) return;
    this.messagesEl.empty();
    this.messages = [];
    this.pendingBlocks = [];
    this.pendingMsgEl = null;
    this.pendingContentEl = null;
    this.streamText = '';
    this.session = { clientKey: randomUUID(), sessionId };

    try {
      const msgs = await this.plugin.bridge.getSessionMessages(sessionId, this.activeProjectPath ?? this.plugin.getEffectiveCwd());
      for (const m of msgs) {
        this.renderHistoryMessage(m);
      }
      this.scrollToBottom();
    } catch (e) {
      this.messagesEl.createEl('div', { cls: 'cc-empty', text: `Could not load history: ${String(e)}` });
    }
  }

  private renderHistoryMessage(m: SessionMessage) {
    const msg = m.message as { role?: string; content?: unknown };
    if (!msg?.role) return;

    const isUser = msg.role === 'user';

    // Skip user turns that contain no text (e.g. tool_result-only synthetic turns)
    if (isUser && Array.isArray(msg.content)) {
      const hasText = (msg.content as ContentBlock[]).some(b => b.type === 'text');
      if (!hasText) return;
    }

    const el = this.messagesEl.createEl('div', {
      cls: `cc-msg ${isUser ? 'cc-msg--user' : 'cc-msg--assistant'}`,
    });
    const content = el.createEl('div', { cls: isUser ? 'cc-msg-content' : 'cc-msg-blocks' });

    if (Array.isArray(msg.content)) {
      for (const block of msg.content as ContentBlock[]) {
        if (block.type === 'text') {
          if (isUser) {
            content.appendChild(this.renderUserTextWithRules((block as ContentBlockText).text));
          } else {
            this.renderTextBlock(block as ContentBlockText, content);
          }
        } else if (block.type === 'tool_use' && !isUser) {
          this.renderToolBlock(block as ContentBlockToolUse, content);
        }
      }
    } else if (typeof msg.content === 'string') {
      content.appendChild(this.renderUserTextWithRules(msg.content));
    }

    // Remove container if nothing was rendered (e.g. assistant turn with unknown block types)
    if (content.childElementCount === 0 && content.childNodes.length === 0) {
      el.remove();
    }
  }

  // Strip injected <rules>…</rules> block from user messages, show compact badge instead
  private renderUserTextWithRules(text: string): HTMLElement {
    const frag = document.createDocumentFragment();
    const rulesRe = /^<rules>\n([\s\S]*?)\n<\/rules>\n\n/;
    const match = rulesRe.exec(text);
    if (match) {
      const badge = document.createElement('span');
      badge.className = 'cc-rules-badge';
      badge.textContent = 'Rules';
      badge.title = match[1];   // full rules text on hover
      frag.appendChild(badge);
      const rest = document.createElement('span');
      rest.textContent = text.slice(match[0].length);
      frag.appendChild(rest);
    } else {
      const span = document.createElement('span');
      span.textContent = text;
      frag.appendChild(span);
    }
    const wrapper = document.createElement('span');
    wrapper.appendChild(frag);
    return wrapper;
  }

  private async confirmDeleteSession() {
    const sid = this.session.sessionId;
    if (!sid) {
      new Notice('No active session to delete.');
      return;
    }
    const modal = new Modal(this.app);
    modal.titleEl.setText('Delete session?');
    modal.contentEl.createEl('p', {
      text: 'This will permanently delete the session and its history. This cannot be undone.',
    });
    const btnRow = modal.contentEl.createEl('div', { cls: 'cc-modal-actions' });
    btnRow.createEl('button', { cls: 'mod-warning', text: 'Delete' })
      .addEventListener('click', async () => {
        modal.close();
        try {
          await this.plugin.bridge!.deleteSession(sid, this.activeProjectPath ?? this.plugin.getEffectiveCwd());
          new Notice('Session deleted.');
          this.newChat();
          this.sessionSelect.value = '';
          await this.refreshSessionList();
        } catch (e) {
          new Notice(`Delete failed: ${String(e)}`);
        }
      });
    btnRow.createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => modal.close());
    modal.open();
  }

  private async injectRules() {
    if (!this.plugin.isDaemonReady()) {
      new Notice('Daemon not ready.');
      return;
    }
    if (this.busy) {
      new Notice('Wait for the current response to finish.');
      return;
    }

    const rulesText = await this.plugin.loadRulesText(this.activeProjectPath ?? undefined);
    if (!rulesText.trim()) {
      new Notice('No rules files found in ' + (this.plugin.settings.rulesPath || 'x-ai-rules') + '/');
      return;
    }

    // Show compact rules-injection indicator in the chat (not a full user bubble)
    const indicator = this.messagesEl.createEl('div', { cls: 'cc-rules-inject' });
    indicator.createEl('span', { cls: 'cc-rules-badge', text: 'Rules' });
    indicator.createEl('span', { text: ' injected into session', cls: 'cc-rules-inject-label' });
    this.scrollToBottom();

    const message = `<rules>\n${rulesText.trim()}\n</rules>\n\nAcknowledge these rules and confirm you will follow them in this session.`;

    this.setBusy(true);
    this.pendingBlocks = [];
    this.pendingContentEl = null;
    this.streamingIndicatorEl = null;
    this.streamingTextEl = null;
    this.streamText = '';
    this.pendingMsgEl = this.messagesEl.createEl('div', { cls: 'cc-msg cc-msg--assistant cc-msg--streaming' });
    this.pendingMsgEl.createEl('div', { cls: 'cc-spinner' });
    this.scrollToBottom();

    this.plugin.bridge!.send(
      {
        clientKey: this.session.clientKey,
        message,
        sessionId: this.session.sessionId,
        cwd: this.getEffectiveSendCwd(),
        model: this.modelSelect.value || this.plugin.settings.model,
        permissionMode: this.modeSelect.value as PermissionMode,
      },
      {
        onSdkMsg: (msg) => this.handleSdkMsg(msg),
        onPermissionRequest: (req) => this.showPermissionDialog(req),
        onQuestionRequest: (req) => this.showQuestionDialog(req),
        onDone: (ok, err) => this.handleTurnDone(ok, err),
      }
    );
  }

  private getEffectiveSendCwd(): string {
    return this.activeProjectPath ?? this.plugin.getEffectiveCwd();
  }

  private addResizeHandle(handle: HTMLElement, inputArea: HTMLElement) {
    let dragging = false;
    let startY = 0;
    let startH = 0;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startY = e.clientY;
      startH = inputArea.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const delta = startY - e.clientY;          // drag up → positive delta → taller
      const newH = Math.max(80, Math.min(600, startH + delta));
      inputArea.style.height = newH + 'px';
      inputArea.style.flexShrink = '0';
      // Keep textarea filling the new height (minus button column)
      this.inputEl.style.minHeight = Math.max(40, newH - 24) + 'px';
      this.inputEl.style.maxHeight = Math.max(40, newH - 24) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
    });
  }

  private scrollToBottom() { this.messagesEl.scrollTop = this.messagesEl.scrollHeight; }

  private applyFontSize() {
    const size = this.plugin.settings.fontSize ?? 14;
    this.messagesEl.style.fontSize = `${size}px`;
    this.inputEl.style.fontSize = `${size}px`;
  }

  private adjustFontSize(delta: number) {
    const current = this.plugin.settings.fontSize ?? 14;
    const next = Math.min(24, Math.max(10, current + delta));
    if (next === current) return;
    this.plugin.settings.fontSize = next;
    void this.plugin.saveSettings();
    this.applyFontSize();
  }
}
