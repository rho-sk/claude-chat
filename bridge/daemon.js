#!/usr/bin/env node
/**
 * Claude Code ACP Bridge Daemon
 *
 * Long-running Node.js process that holds open SDK sessions and handles
 * requests from the Obsidian plugin over stdin/stdout using NDJSON.
 *
 * Plugin → Daemon (stdin):
 *   {"id":"1","method":"claude.send","params":{...}}
 *   {"id":"2","method":"interaction_response","params":{"interactionId":"...","behavior":"allow"}}
 *   {"id":"3","method":"heartbeat"}
 *   {"id":"4","method":"claude.abort","params":{"clientKey":"..."}}
 *   {"id":"5","method":"shutdown"}
 *
 * Daemon → Plugin (stdout):
 *   {"type":"daemon","event":"ready","pid":123}
 *   {"id":"1","sdkMsg":{"type":"stream_event",...}}   ← SDK messages forwarded directly
 *   {"id":"1","permissionRequest":{...}}              ← canUseTool callback needs UI
 *   {"id":"1","done":true,"success":true}
 */

import { createInterface } from 'readline';
import { query as claudeQuery, listSessions, getSessionMessages, deleteSession } from '@anthropic-ai/claude-agent-sdk';
import { AsyncStream } from './async-stream.js';

// =============================================================================
// Output interception – use _write for all daemon→plugin messages so that
// any SDK/Claude binary writes to stdout are captured and not mixed in.
// =============================================================================

const _write = process.stdout.write.bind(process.stdout);
const _errWrite = process.stderr.write.bind(process.stderr);

let activeId = null;

function raw(obj) {
  _write(JSON.stringify(obj) + '\n', 'utf8');
}

function daemonEvent(event, data = {}) {
  raw({ type: 'daemon', event, ...data });
}

// Intercept any SDK/Claude binary writes → wrap as debug lines for the plugin
process.stdout.write = (chunk, enc, cb) => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString(enc || 'utf8');
  if (activeId) {
    for (const line of text.split('\n')) {
      if (line.trim()) raw({ id: activeId, debugLine: line });
    }
    if (typeof cb === 'function') cb();
    return true;
  }
  // Outside of an active request: let plain JSON pass, wrap other text
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return _write(chunk, enc, cb);
  if (trimmed) {
    for (const line of text.split('\n')) {
      if (line.trim()) raw({ type: 'daemon', event: 'log', message: line });
    }
  }
  if (typeof cb === 'function') cb();
  return true;
};

console.log = (...args) =>
  process.stdout.write(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n');

console.error = (...args) => {
  const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  _errWrite(text + '\n', 'utf8');
};

// Prevent SDK from killing the daemon
let daemonMode = true;
const _exit = process.exit;
process.exit = (code) => {
  if (!daemonMode) return _exit(code);
  const id = activeId;
  activeId = null;
  if (id) raw({ id, done: true, success: code === 0, ...(code !== 0 && { error: `process.exit(${code})` }) });
  throw new Error(`[daemon] exit(${code}) intercepted`);
};

// =============================================================================
// Pending interactions – permission / question callbacks waiting for plugin UI
// =============================================================================

/** @type {Map<string, (result: unknown) => void>} */
const pendingInteractions = new Map();

function makePendingInteraction(timeoutMs = 120_000) {
  const interactionId = `int-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const promise = new Promise((resolve) => {
    pendingInteractions.set(interactionId, resolve);
    setTimeout(() => {
      if (pendingInteractions.delete(interactionId)) resolve({ behavior: 'deny' });
    }, timeoutMs);
  });
  return { interactionId, promise };
}

// =============================================================================
// Runtime registry
// =============================================================================

/** @type {Map<string, { inputStream: AsyncStream, query: object, sessionId: string|null, closed: boolean }>} */
const runtimes = new Map();

function createRuntime(clientKey, params) {
  const inputStream = new AsyncStream();

  const options = {
    cwd: params.cwd || process.cwd(),
    permissionMode: params.permissionMode || 'default',
    maxTurns: 100,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    includePartialMessages: true,
    ...(params.sessionId ? { resume: params.sessionId } : {}),
  };

  if (params.model) options.model = params.model;
  if (params.thinkingConfig) options.thinkingConfig = params.thinkingConfig;
  if (params.extendedContext) options.betas = ['context-1m-2025-08-07'];
  if (params.appendSystemPrompt) options.appendSystemPrompt = params.appendSystemPrompt;

  // When permissionMode is 'default', intercept tool permission requests and
  // forward them to the plugin UI via the canUseTool SDK callback.
  if (!params.permissionMode || params.permissionMode === 'default') {
    options.canUseTool = async (toolName, input, context) => {
      const { interactionId, promise } = makePendingInteraction(120_000);

      // AskUserQuestion is a special Claude Code tool – instead of Allow/Deny,
      // we show the actual question UI and inject the answers back via updatedInput.
      if (toolName === 'AskUserQuestion') {
        const questions = Array.isArray(input.questions) ? input.questions : [];
        raw({ id: activeId, questionRequest: { interactionId, questions } });

        const result = await promise;
        const answers = result.answers ?? {};
        return { behavior: 'allow', updatedInput: { ...input, answers } };
      }

      // Regular tool – show Allow/Deny permission dialog
      raw({
        id: activeId,
        permissionRequest: {
          interactionId,
          toolName,
          input,
          title: context?.title,
          description: context?.description,
          displayName: context?.displayName,
        },
      });

      const { behavior } = await promise;

      // PermissionResult: allow requires updatedInput (binary Zod schema),
      // deny requires message (required field in SDK type)
      if (behavior === 'allow') {
        return { behavior: 'allow', updatedInput: input };
      } else {
        return { behavior: 'deny', message: 'Denied by user' };
      }
    };
  }

  const q = claudeQuery({ prompt: inputStream, options });
  const runtime = { inputStream, query: q, sessionId: params.sessionId || null, closed: false };
  runtimes.set(clientKey, runtime);
  return runtime;
}

function getRuntime(clientKey, params) {
  const existing = runtimes.get(clientKey);
  if (existing && !existing.closed) return existing;
  return createRuntime(clientKey, params);
}

function closeRuntime(clientKey) {
  const r = runtimes.get(clientKey);
  if (!r) return;
  r.closed = true;
  try { r.inputStream.done(); } catch (_) {}
  try { r.query?.close?.(); } catch (_) {}
  runtimes.delete(clientKey);
}

function closeAllRuntimes() {
  for (const key of [...runtimes.keys()]) closeRuntime(key);
}

// =============================================================================
// Command: claude.send
// =============================================================================

async function handleSend(params) {
  const { message, clientKey, sessionId, cwd, permissionMode, model } = params;

  if (!clientKey) throw new Error('Missing required param: clientKey');
  if (!message && message !== '') throw new Error('Missing required param: message');

  const runtime = getRuntime(clientKey, { sessionId, cwd, permissionMode, model, appendSystemPrompt: params.appendSystemPrompt });

  runtime.inputStream.enqueue({
    type: 'user',
    session_id: runtime.sessionId || '',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text: String(message) }] },
  });

  // Forward all SDK messages directly – plugin handles them by type natively.
  // raw() uses _write (original stdout) to bypass the stdout interceptor.
  while (true) {
    let next;
    try {
      next = await runtime.query.next();
    } catch (err) {
      runtime.closed = true;
      runtimes.delete(clientKey);
      throw err;
    }

    if (next.done) {
      runtime.closed = true;
      runtimes.delete(clientKey);
      throw new Error('Claude session stream ended unexpectedly');
    }

    const msg = next.value;
    if (msg?.session_id) runtime.sessionId = msg.session_id;

    raw({ id: activeId, sdkMsg: msg });

    if (msg?.type === 'result') {
      if (msg.is_error) throw new Error(msg.result || 'API error');
      break;
    }
  }
}

// =============================================================================
// Main event loop
// =============================================================================

process.on('uncaughtException', (err) => {
  _errWrite(`[daemon] uncaughtException: ${err.message}\n`, 'utf8');
  if (activeId) {
    raw({ id: activeId, done: true, success: false, error: `Uncaught: ${err.message}` });
    activeId = null;
  }
});

process.on('unhandledRejection', (reason) => {
  _errWrite(`[daemon] unhandledRejection: ${reason}\n`, 'utf8');
  if (activeId) {
    raw({ id: activeId, done: true, success: false, error: `Unhandled rejection: ${String(reason)}` });
    activeId = null;
  }
});

daemonEvent('starting', { pid: process.pid, nodeVersion: process.version });
daemonEvent('ready', { pid: process.pid });

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let cmdQueue = Promise.resolve();

rl.on('line', (line) => {
  if (!line.trim()) return;

  let req;
  try { req = JSON.parse(line); } catch {
    _errWrite(`[daemon] invalid JSON: ${line.slice(0, 200)}\n`, 'utf8');
    return;
  }

  const { id, method, params = {} } = req;

  // ── Out-of-band: heartbeat ─────────────────────────────────────────────────
  if (method === 'heartbeat') {
    raw({ id: id || '0', type: 'heartbeat', ts: Date.now(), runtimes: runtimes.size });
    return;
  }

  // ── Out-of-band: interaction response (permission / question answer) ───────
  // Must be handled immediately – the canUseTool callback is awaiting this.
  if (method === 'interaction_response') {
    const { interactionId, behavior, answers } = params;
    const resolve = pendingInteractions.get(interactionId);
    if (resolve) {
      pendingInteractions.delete(interactionId);
      // Question response carries `answers` (object); permission response carries `behavior`
      if (answers !== undefined && answers !== null && typeof answers === 'object' && !Array.isArray(answers)) {
        resolve({ answers });
      } else {
        resolve({ behavior: behavior || 'deny' });
      }
    }
    if (id) raw({ id, done: true, success: true });
    return;
  }

  // ── Out-of-band: abort ─────────────────────────────────────────────────────
  if (method === 'claude.abort') {
    const targetKey = params.clientKey;
    if (targetKey) closeRuntime(targetKey);
    else closeAllRuntimes();
    if (id) raw({ id, done: true, success: true });
    return;
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  if (method === 'shutdown') {
    closeAllRuntimes();
    daemonEvent('shutdown', { reason: 'requested' });
    if (id) raw({ id, done: true, success: true });
    daemonMode = false;
    setTimeout(() => _exit(0), 100);
    return;
  }

  // ── Out-of-band: read-only SDK queries (don't block the command queue) ──────

  if (method === 'list_sessions') {
    listSessions({ dir: params.dir || undefined, limit: params.limit || 30 })
      .then((sessions) => raw({ id, sessions, done: true, success: true }))
      .catch((err) => raw({ id, done: true, success: false, error: err.message }));
    return;
  }

  if (method === 'get_session_messages') {
    if (!params.sessionId) { raw({ id, done: true, success: false, error: 'Missing sessionId' }); return; }
    getSessionMessages(params.sessionId, { dir: params.dir || undefined })
      .then((messages) => raw({ id, messages, done: true, success: true }))
      .catch((err) => raw({ id, done: true, success: false, error: err.message }));
    return;
  }

  if (method === 'delete_session') {
    if (!params.sessionId) { raw({ id, done: true, success: false, error: 'Missing sessionId' }); return; }
    deleteSession(params.sessionId, { dir: params.dir || undefined })
      .then(() => raw({ id, done: true, success: true }))
      .catch((err) => raw({ id, done: true, success: false, error: err.message }));
    return;
  }

  if (!id) {
    _errWrite(`[daemon] request without id: ${method}\n`, 'utf8');
    return;
  }

  // ── Serialised command queue ───────────────────────────────────────────────
  cmdQueue = cmdQueue
    .then(async () => {
      activeId = id;
      try {
        if (method === 'claude.send') {
          await handleSend(params);
        } else {
          throw new Error(`Unknown method: ${method}`);
        }
        raw({ id, done: true, success: true });
      } catch (err) {
        if (activeId !== null) {
          raw({ id, done: true, success: false, error: err.message || String(err) });
        }
      } finally {
        activeId = null;
      }
    })
    .catch((e) => _errWrite(`[daemon] queue error: ${e.message}\n`, 'utf8'));
});

rl.on('close', () => {
  closeAllRuntimes();
  daemonMode = false;
  _exit(0);
});

// Exit when parent process disappears
const initialPpid = process.ppid;
const ppidTimer = setInterval(() => {
  const ppid = process.ppid;
  const reparented = ppid !== initialPpid && ppid === 1;
  let gone = false;
  if (!reparented) {
    try { process.kill(ppid, 0); } catch (e) { gone = e.code === 'ESRCH'; }
  }
  if (reparented || gone) {
    _errWrite('[daemon] parent gone, exiting\n', 'utf8');
    daemonMode = false;
    _exit(0);
  }
}, 10_000);
ppidTimer.unref();
