// ── Daemon transport protocol ──────────────────────────────────────────────────

export interface DaemonEvent {
  type: 'daemon';
  event: string;
  pid?: number;
  message?: string;
  [key: string]: unknown;
}

export interface DaemonSdkMsg {
  id: string;
  sdkMsg: SDKMessage;
}

export interface PermissionRequestPayload {
  interactionId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
  displayName?: string;
}

export interface DaemonPermissionRequest {
  id: string;
  permissionRequest: PermissionRequestPayload;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionDef {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export interface QuestionRequestPayload {
  interactionId: string;
  questions: QuestionDef[];
}

export interface DaemonQuestionRequest {
  id: string;
  questionRequest: QuestionRequestPayload;
}

export interface DaemonDone {
  id: string;
  done: true;
  success: boolean;
  error?: string;
}

export interface DaemonHeartbeat {
  id: string;
  type: 'heartbeat';
  ts: number;
  runtimes?: number;
}

export type DaemonMessage = DaemonEvent | DaemonSdkMsg | DaemonPermissionRequest | DaemonQuestionRequest | DaemonDone | DaemonHeartbeat;

// ── SDK message types (native, matching @anthropic-ai/claude-agent-sdk) ─────────

export interface ContentBlockText {
  type: 'text';
  text: string;
}

export interface ContentBlockToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlock = ContentBlockText | ContentBlockToolUse | { type: string; [k: string]: unknown };

// system init – carries session_id on first turn
export interface SDKSystemMessage {
  type: 'system';
  subtype: 'init' | string;
  session_id: string;
  [k: string]: unknown;
}

// streaming token delta (includePartialMessages: true)
export interface SDKStreamEvent {
  type: 'stream_event';
  session_id: string;
  event: {
    type: string;                 // 'content_block_delta' | 'content_block_start' | ...
    index?: number;
    delta?: {
      type: string;               // 'text_delta' | 'thinking_delta' | ...
      text?: string;
      thinking?: string;
    };
    content_block?: { type: string; [k: string]: unknown };
  };
  [k: string]: unknown;
}

// complete assistant turn
export interface SDKAssistantMessage {
  type: 'assistant';
  session_id: string;
  message: {
    role: 'assistant';
    content: ContentBlock[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// turn result (success or error)
export interface SDKResultMessage {
  type: 'result';
  subtype: 'success' | 'error';
  session_id: string;
  is_error: boolean;
  result?: string;
  [k: string]: unknown;
}

export type SDKMessage =
  | SDKSystemMessage
  | SDKStreamEvent
  | SDKAssistantMessage
  | SDKResultMessage
  | { type: string; session_id?: string; [k: string]: unknown };

// ── SDK session types ─────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  firstPrompt?: string;
  cwd?: string;
  customTitle?: string;
}

export interface SessionMessage {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: string | null;
}

// ── Chat state ────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string | ContentBlock[];
  timestamp: number;
}

export interface ChatSession {
  clientKey: string;
  sessionId: string;
}

// ── Plugin settings ───────────────────────────────────────────────────────────

export type SendKey = 'ctrl+enter' | 'enter';
export type PermissionMode = 'default' | 'bypassPermissions' | 'acceptEdits' | 'plan' | 'auto';

export interface ThinkingConfig {
  type: 'enabled' | 'adaptive' | 'disabled';
  budgetTokens?: number;
}

export interface ClaudeChatSettings {
  cwd: string;
  model: string;
  sendKey: SendKey;
  permissionMode: PermissionMode;
  nodePath: string;
  projectsFolder: string;
  rulesPath: string;
}

export const DEFAULT_SETTINGS: ClaudeChatSettings = {
  cwd: '',
  model: '',
  sendKey: 'ctrl+enter',
  permissionMode: 'default',
  nodePath: '',
  projectsFolder: 'projects',
  rulesPath: 'x-ai-rules',
};
