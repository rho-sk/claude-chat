import { ChildProcess, spawn } from 'child_process';
import { createInterface } from 'readline';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import type {
  DaemonMessage, DaemonSdkMsg, DaemonDone,
  DaemonPermissionRequest, DaemonQuestionRequest,
  SDKMessage, PermissionRequestPayload, QuestionRequestPayload,
  ThinkingConfig, SessionInfo, SessionMessage,
} from './types';

export interface SendParams {
  clientKey: string;
  message: string;
  sessionId: string;
  cwd: string;
  model: string;
  permissionMode: string;
  thinkingConfig?: ThinkingConfig;
  extendedContext?: boolean;
  appendSystemPrompt?: string;
}

export interface SendCallbacks {
  onSdkMsg: (msg: SDKMessage) => void;
  onPermissionRequest: (req: PermissionRequestPayload) => void;
  onQuestionRequest: (req: QuestionRequestPayload) => void;
  onDone: (success: boolean, error?: string) => void;
}

// ── DaemonBridge ──────────────────────────────────────────────────────────────

export class DaemonBridge extends EventEmitter {
  private proc: ChildProcess | null = null;
  private idCounter = 0;
  private pending = new Map<string, SendCallbacks>();
  private readCallbacks = new Map<string, (msg: DaemonMessage) => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeat = 0;
  private ready = false;
  private readyResolve: (() => void) | null = null;
  private daemonPath: string;
  private userNodePath: string;

  constructor(daemonPath: string, userNodePath = '') {
    super();
    this.daemonPath = daemonPath;
    this.userNodePath = userNodePath;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const nodeBin = this.userNodePath || 'node';

    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;

      this.proc = spawn(nodeBin, [this.daemonPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      const rl = createInterface({ input: this.proc.stdout!, crlfDelay: Infinity });
      rl.on('line', (line) => this.handleLine(line));

      this.proc.stderr?.on('data', (chunk: Buffer) => {
        this.emit('stderr', chunk.toString());
      });

      this.proc.on('exit', (code) => {
        this.ready = false;
        this.emit('exit', code);
        for (const [id, cb] of this.pending) {
          cb.onDone(false, `Daemon exited (code ${code})`);
          this.pending.delete(id);
        }
      });

      this.proc.on('error', (err) => {
        reject(new Error(
          `Failed to spawn daemon (${err.message})\n\n` +
          'Set the "Node.js path" in plugin settings (e.g. /usr/bin/node).'
        ));
      });

      const timeout = setTimeout(() => {
        if (!this.ready) reject(new Error('Daemon startup timeout (30 s)'));
      }, 30_000);

      this.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.writeRaw({ id: this.nextId(), method: 'shutdown' });
    setTimeout(() => this.proc?.kill(), 500);
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  send(params: SendParams, callbacks: SendCallbacks): string {
    const id = this.nextId();
    this.pending.set(id, callbacks);
    this.writeRaw({ id, method: 'claude.send', params });
    return id;
  }

  abort(clientKey?: string) {
    const id = this.nextId();
    this.writeRaw({ id, method: 'claude.abort', params: clientKey ? { clientKey } : {} });
  }

  respondInteraction(interactionId: string, behavior: 'allow' | 'deny') {
    const id = this.nextId();
    this.writeRaw({ id, method: 'interaction_response', params: { interactionId, behavior } });
  }

  respondQuestion(interactionId: string, answers: Record<string, string | string[]>) {
    const id = this.nextId();
    this.writeRaw({ id, method: 'interaction_response', params: { interactionId, answers } });
  }

  // ── Read-only SDK queries ────────────────────────────────────────────────────

  listSessions(dir?: string): Promise<SessionInfo[]> {
    return this.request<SessionInfo[]>('list_sessions', { dir, limit: 30 }, 'sessions');
  }

  getSessionMessages(sessionId: string, dir?: string): Promise<SessionMessage[]> {
    return this.request<SessionMessage[]>('get_session_messages', { sessionId, dir }, 'messages');
  }

  deleteSession(sessionId: string, dir?: string): Promise<void> {
    return this.request<void>('delete_session', { sessionId, dir }, 'ignored');
  }

  private request<T>(method: string, params: Record<string, unknown>, resultKey: string): Promise<T> {
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.readCallbacks.set(id, (msg) => {
        if ((msg as Record<string, unknown>).success === false) {
          reject(new Error(String((msg as Record<string, unknown>).error ?? 'Request failed')));
        } else {
          resolve((msg as Record<string, unknown>)[resultKey] as T);
        }
      });
      this.writeRaw({ id, method, params });
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private nextId(): string {
    return String(++this.idCounter);
  }

  private writeRaw(obj: Record<string, unknown>) {
    if (!this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify(obj) + '\n', 'utf8');
  }

  private handleLine(raw: string) {
    if (!raw.trim()) return;
    let msg: DaemonMessage;
    try {
      msg = JSON.parse(raw) as DaemonMessage;
    } catch {
      this.emit('stderr', `[ipc] bad JSON: ${raw.slice(0, 200)}`);
      return;
    }

    // Daemon lifecycle
    if ('type' in msg && msg.type === 'daemon') {
      if (msg.event === 'ready') {
        this.ready = true;
        this.startHeartbeat();
        this.emit('ready');
        this.readyResolve?.();
        this.readyResolve = null;
      }
      this.emit('daemon-event', msg);
      return;
    }

    // Heartbeat
    if ('type' in msg && msg.type === 'heartbeat') {
      this.lastHeartbeat = Date.now();
      return;
    }

    const id = (msg as { id?: string }).id;
    if (!id) return;

    // Read-only request callbacks (listSessions, getSessionMessages)
    const readCb = this.readCallbacks.get(id);
    if (readCb && 'done' in msg) {
      this.readCallbacks.delete(id);
      readCb(msg);
      return;
    }

    const cb = this.pending.get(id);
    if (!cb) return;

    // SDK message forwarded from daemon
    if ('sdkMsg' in msg) {
      cb.onSdkMsg((msg as DaemonSdkMsg).sdkMsg);
      return;
    }

    // Permission request from canUseTool callback – needs UI response
    if ('permissionRequest' in msg) {
      cb.onPermissionRequest((msg as DaemonPermissionRequest).permissionRequest);
      return;
    }

    // AskUserQuestion – needs question UI response
    if ('questionRequest' in msg) {
      cb.onQuestionRequest((msg as DaemonQuestionRequest).questionRequest);
      return;
    }

    // Done signal
    if ('done' in msg) {
      const done = msg as DaemonDone;
      this.pending.delete(id);
      cb.onDone(done.success, done.error);
    }
  }

  private startHeartbeat() {
    this.lastHeartbeat = Date.now();
    this.heartbeatTimer = setInterval(() => {
      this.writeRaw({ id: `hb-${Date.now()}`, method: 'heartbeat' });
      if (Date.now() - this.lastHeartbeat > 45_000) {
        this.emit('heartbeat-timeout');
      }
    }, 15_000);
  }
}

// Re-export for convenience
export { existsSync };
