/**
 * 启动与管理 Codex SDK 会话，解析流式输出并驱动一轮对话回合。
 *
 * Keywords: codex-runner, sdk, streaming, abort
 *
 * Exports:
 * - statusLabel — 状态标签辅助。
 * - runCodexTurn — 主路径：跑一轮 Codex。
 * - abortCodexTurn / getActiveRuns — 控制运行中回合。
 *
 * Inward（本模块依赖/组装的关键符号）: @openai/codex-sdk、服务层配置。
 *
 * Outward（谁在用/调用场景）: chat-service、push、状态 API。
 *
 * 不负责: HTTP 请求解析。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCodexLarkCliContext } from './lark-cli.js';
import { detectFeishuSkillKeys } from './feishu-skills.js';
import { codexSandboxForPermissionMode } from './permission-policy.js';
import { readSecurityOptions } from './security-options.js';

const activeRuns = new Map();
const NON_ASCII_PATH_PATTERN = /[^\u0000-\u007F]/;
const DEFAULT_TURN_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_TURN_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const TURN_TIMEOUT_MS = parseTurnTimeoutMs(process.env.CODEXMOBILE_TURN_TIMEOUT_MS, DEFAULT_TURN_TIMEOUT_MS);
const TURN_INACTIVITY_TIMEOUT_MS = parseTurnTimeoutMs(
  process.env.CODEXMOBILE_TURN_INACTIVITY_TIMEOUT_MS,
  DEFAULT_TURN_INACTIVITY_TIMEOUT_MS
);

function parseTurnTimeoutMs(value, fallbackMs = DEFAULT_TURN_TIMEOUT_MS) {
  const timeoutMs = Number(value);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.max(1000, Math.floor(timeoutMs));
  }
  return fallbackMs;
}

function formatTimeoutDuration(timeoutMs) {
  if (timeoutMs >= 60_000) {
    return `${Math.round(timeoutMs / 60_000)} 分钟`;
  }
  return `${Math.round(timeoutMs / 1000)} 秒`;
}

function turnTimeoutError() {
  const error = new Error(`Codex turn timed out after ${formatTimeoutDuration(TURN_TIMEOUT_MS)}`);
  error.code = 'CODEXMOBILE_TURN_TIMEOUT';
  return error;
}

function turnInactivityTimeoutError() {
  const error = new Error(`Codex turn had no activity for ${formatTimeoutDuration(TURN_INACTIVITY_TIMEOUT_MS)}`);
  error.code = 'CODEXMOBILE_TURN_INACTIVITY_TIMEOUT';
  return error;
}

function isTurnTimeoutError(error) {
  return error?.code === 'CODEXMOBILE_TURN_TIMEOUT';
}

function isTurnInactivityTimeoutError(error) {
  return error?.code === 'CODEXMOBILE_TURN_INACTIVITY_TIMEOUT';
}

async function ensureAsciiWorkingDirectory(projectPath) {
  if (process.platform !== 'win32' || !NON_ASCII_PATH_PATTERN.test(projectPath)) {
    return projectPath;
  }

  const resolved = path.resolve(projectPath);
  const driveRoot = path.parse(resolved).root || 'C:\\';
  const aliasRoot = path.join(driveRoot, 'codex_project_aliases');
  const aliasName = crypto.createHash('sha1').update(resolved.toLowerCase()).digest('hex');
  const aliasPath = path.join(aliasRoot, aliasName);

  await fs.mkdir(aliasRoot, { recursive: true });
  try {
    const stats = await fs.lstat(aliasPath);
    if (stats.isDirectory() || stats.isSymbolicLink()) {
      return aliasPath;
    }
    await fs.rm(aliasPath, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.symlink(resolved, aliasPath, 'junction');
  return aliasPath;
}

function mapPermissionMode(permissionMode) {
  return codexSandboxForPermissionMode(permissionMode, readSecurityOptions());
}

function normalizeReasoningEffort(reasoningEffort) {
  const value = String(reasoningEffort || '').trim();
  return ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(value) ? value : undefined;
}

function textFromContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part?.type === 'output_text' || part?.type === 'input_text' || part?.type === 'text') {
        return part.text || '';
      }
      return part?.text || '';
    })
    .filter(Boolean)
    .join('\n');
}

function contentFromItem(item) {
  if (!item) {
    return '';
  }
  const contentText = textFromContent(item.content);
  if (contentText) {
    return contentText;
  }
  if (typeof item.text === 'string') {
    return item.text;
  }
  if (typeof item.aggregated_output === 'string') {
    return item.aggregated_output;
  }
  if (typeof item.message === 'string') {
    return item.message;
  }
  return '';
}

export function statusLabel(kind, status = 'running') {
  const done = status === 'completed';
  const failed = status === 'failed';
  const labels = {
    turn: done ? '任务已完成' : failed ? '任务失败' : '正在处理',
    reasoning: done ? '思考完成' : '正在思考',
    agent_message: '正在回复',
    message: '正在回复',
    command_execution: done ? '本地任务已处理' : failed ? '本地任务失败' : '正在处理本地任务',
    file_change: done ? '文件已更新' : failed ? '文件更新失败' : '正在更新文件',
    mcp_tool_call: done ? '已完成一步操作' : failed ? '这一步操作失败' : '正在完成一步操作',
    dynamic_tool_call: done ? '已完成一步操作' : failed ? '这一步操作失败' : '正在完成一步操作',
    web_search: done ? '网页信息已查到' : failed ? '网页搜索失败' : '正在查找网页信息',
    plan: done ? '计划已更新' : '正在规划',
    plan_implementation: done ? '计划已确认执行' : '等待确认执行计划',
    todo_list: done ? '计划已更新' : '正在规划',
    image_generation_call: done ? '图片生成完成' : failed ? '图片生成失败' : '正在生成图片',
    context_compaction: '上下文已自动压缩',
    custom_tool_call: done ? '已完成一步操作' : failed ? '这一步操作失败' : '正在完成一步操作',
    function_call: done ? '已完成一步操作' : failed ? '这一步操作失败' : '正在完成一步操作',
    error: '出现错误'
  };
  return labels[kind] || (done ? '已完成' : failed ? '失败' : '正在处理');
}

function compactStatusLabel(content, fallback = '正在处理') {
  const label = String(content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) {
    return fallback;
  }
  return label.length > 68 ? `${label.slice(0, 68)}...` : label;
}

function detailFromItem(item) {
  if (!item) {
    return '';
  }
  if (item.command) {
    return item.command;
  }
  if (item.query) {
    return item.query;
  }
  if (item.action?.query) {
    return item.action.query;
  }
  if (Array.isArray(item.action?.queries) && item.action.queries.length) {
    return item.action.queries.join('\n');
  }
  if (item.action?.url) {
    return item.action.url;
  }
  if (item.action?.pattern && item.action?.url) {
    return `${item.action.pattern} in ${item.action.url}`;
  }
  if (item.tool || item.server) {
    return [item.server, item.tool].filter(Boolean).join(' / ');
  }
  if (Array.isArray(item.changes)) {
    return item.changes.map((change) => `${change.kind || 'update'} ${change.path}`).join('\n');
  }
  if (item.message) {
    return item.message;
  }
  if (item.planContent) {
    return item.planContent;
  }
  return item.aggregatedOutput || contentFromItem(item);
}

function diffStats(unifiedDiff = '') {
  let additions = 0;
  let deletions = 0;
  for (const line of String(unifiedDiff || '').split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function normalizeFileChanges(item) {
  const changes = item?.changes;
  if (Array.isArray(changes)) {
    return changes.map((change) => {
      const diff = change?.unified_diff || change?.diff || '';
      const stats = diffStats(diff);
      return {
        ...change,
        additions: Number(change?.additions) || stats.additions,
        deletions: Number(change?.deletions) || stats.deletions,
        unifiedDiff: diff,
        movePath: change?.move_path || change?.movePath || null
      };
    });
  }
  if (!changes || typeof changes !== 'object') {
    return [];
  }
  return Object.entries(changes).map(([filePath, change]) => {
    const stats = diffStats(change?.unified_diff || change?.diff || '');
    return {
      path: filePath,
      kind: change?.type || change?.kind || 'update',
      additions: Number(change?.additions) || stats.additions,
      deletions: Number(change?.deletions) || stats.deletions,
      unifiedDiff: change?.unified_diff || change?.diff || '',
      movePath: change?.move_path || null
    };
  });
}

function maybeIsoFromTimeValue(value) {
  if (typeof value === 'string' && value.trim() && !/^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const millis = seconds > 10_000_000_000 ? seconds : seconds * 1000;
  return new Date(millis).toISOString();
}

function turnTimingPayload(turn, { fallbackStartedAt = null, fallbackCompletedAt = null } = {}) {
  const startedAt = maybeIsoFromTimeValue(turn?.startedAt) || fallbackStartedAt || null;
  const completedAt = maybeIsoFromTimeValue(turn?.completedAt) || fallbackCompletedAt || null;
  let durationMs = positiveNumber(turn?.durationMs);
  if (!durationMs && startedAt && completedAt) {
    const startMs = new Date(startedAt).getTime();
    const endMs = new Date(completedAt).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      durationMs = endMs - startMs;
    }
  }
  return { startedAt, completedAt, durationMs };
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function emitStatus(emit, {
  sessionId,
  turnId,
  kind,
  status = 'running',
  label,
  detail = '',
  startedAt = null,
  completedAt = null,
  durationMs = null,
  timestamp = null
}) {
  emit({
    type: 'status-update',
    sessionId,
    turnId,
    kind,
    status,
    label: label || statusLabel(kind, status),
    detail,
    timestamp: timestamp || completedAt || startedAt || new Date().toISOString(),
    startedAt,
    completedAt,
    durationMs
  });
}

function isSpawnPermissionError(error) {
  return error?.code === 'EPERM' && String(error?.syscall || '').startsWith('spawn');
}

function userFacingCodexError(error) {
  const message = String(error?.message || 'Codex task failed');
  if (process.platform === 'win32' && isSpawnPermissionError(error)) {
    return [
      'Codex 执行器启动被 Windows 拒绝（spawn EPERM）。',
      '通常是后台服务从受限环境启动导致的，请重启正式服务后再试。'
    ].join(' ');
  }
  return message;
}

function codexErrorDiagnostics(error) {
  return {
    message: error?.message || '',
    code: error?.code || '',
    errno: error?.errno || '',
    syscall: error?.syscall || '',
    path: error?.path || '',
    spawnargs: Array.isArray(error?.spawnargs) ? error.spawnargs : [],
    cwd: process.cwd(),
    execPath: process.execPath,
    pathLength: String(process.env.Path || process.env.PATH || '').length
  };
}

function emitActivity(emit, { sessionId, turnId, messageId, item, kind, status }) {
  const detail = detailFromItem(item);
  emit({
    type: 'activity-update',
    sessionId,
    turnId,
    messageId,
    kind,
    label: statusLabel(kind, status),
    status,
    detail,
    command: item?.command || '',
    output: item?.aggregated_output || item?.aggregatedOutput || item?.output || '',
    exitCode: item?.exitCode ?? item?.exit_code ?? null,
    fileChanges: normalizeFileChanges(item),
    toolName: item?.tool || item?.name || '',
    error: item?.error?.message || item?.message || '',
    timestamp: new Date().toISOString()
  });
}

function eventItem(event) {
  if (event.item) {
    return event.item;
  }
  if (event.payload && (event.type === 'response_item' || event.type === 'event_msg')) {
    return event.payload;
  }
  return null;
}

function eventStatus(event, item) {
  if (item?.status) {
    if (item.status === 'in_progress') {
      return 'running';
    }
    return item.status;
  }
  if (event.type === 'item.completed') {
    return 'completed';
  }
  if (event.type === 'item.started' || event.type === 'item.updated') {
    return 'running';
  }
  if (event.type === 'event_msg' && item?.type?.endsWith('_end')) {
    return item.exit_code || item.exit_code === 0 ? (item.exit_code === 0 ? 'completed' : 'failed') : 'completed';
  }
  if (event.type === 'response_item') {
    return 'completed';
  }
  return 'running';
}

function itemKindFromEvent(item) {
  const type = String(item?.type || '').trim();
  const kinds = {
    agentMessage: 'agent_message',
    commandExecution: 'command_execution',
    fileChange: 'file_change',
    mcpToolCall: 'mcp_tool_call',
    dynamicToolCall: 'dynamic_tool_call',
    webSearch: 'web_search',
    imageGeneration: 'image_generation_call',
    contextCompaction: 'context_compaction',
    plan: 'plan',
    planImplementation: 'plan_implementation',
    'plan-implementation': 'plan_implementation',
    reasoning: 'reasoning',
    userMessage: 'user_message'
  };
  return kinds[type] || type || 'item';
}

function emitCodexEvent(event, sessionId, turnId, emit, state, startedAt) {
  const threadId = event.thread_id || event.id || event.payload?.id;
  if (event.type === 'thread.started' && threadId) {
    return;
  }
  if (event.type === 'thread.completed' || event.type === 'turn.completed') {
    state.usage = event.turn || event.payload?.turn || null;
    const timing = turnTimingPayload(state.usage, {
      fallbackStartedAt: startedAt,
      fallbackCompletedAt: new Date().toISOString()
    });
    emitStatus(emit, {
      sessionId,
      turnId,
      kind: 'turn',
      status: 'completed',
      label: '任务已完成',
      ...timing,
      timestamp: timing.completedAt
    });
    return;
  }
  if (event.type === 'error' || event.type === 'turn.failed') {
    const error = event.error?.message || event.error || 'Codex turn failed';
    state.failed = true;
    emitStatus(emit, { sessionId, turnId, kind: 'turn', status: 'failed', label: '任务失败', detail: error });
    emit({ type: 'turn-failed', sessionId, turnId, error });
    return;
  }

  const item = eventItem(event);
  if (!item) {
    return;
  }

  const kind = itemKindFromEvent(item);
  const status = eventStatus(event, item);
  const messageId = item.id || `${turnId}-${kind}`;
  const detail = detailFromItem(item);

  if (kind === 'agent_message') {
    const content = contentFromItem(item);
    if (!content.trim()) {
      return;
    }
    const isCommentary = String(item.phase || '').toLowerCase() === 'commentary';
    
    // commentary → 只发送 status（放入执行卡片）
    if (isCommentary) {
      emitStatus(emit, {
        sessionId,
        turnId,
        kind: 'agent_message',
        status: 'running',
        label: compactStatusLabel(content)
      });
      return;
    }
    
    // 中间过程 / 最终消息 → 发送 assistant-update
    const isIntermediate = status !== 'completed';
    emit({
      type: 'assistant-update',
      sessionId,
      turnId,
      messageId,
      role: 'assistant',
      kind: 'agent_message',
      phase: 'final_answer',
      content,
      status,
      done: !isIntermediate
    });
    state.hadAssistantText = true;
    return;
  }

  if (kind === 'reasoning') {
    emitStatus(emit, { sessionId, turnId, kind: 'reasoning', status, label: statusLabel('reasoning', status) });
    return;
  }

  if (
    kind === 'command_execution' ||
    kind === 'file_change' ||
    kind === 'mcp_tool_call' ||
    kind === 'web_search' ||
    kind === 'todo_list' ||
    kind === 'image_generation_call' ||
    kind === 'custom_tool_call' ||
    kind === 'function_call' ||
    kind === 'function_call_output' ||
    kind === 'exec_command_begin' ||
    kind === 'exec_command_end'
  ) {
    const normalizedKind =
      kind === 'exec_command_begin' || kind === 'exec_command_end' ? 'command_execution' : kind;
    const normalizedStatus = kind === 'function_call_output' ? 'completed' : status;
    emitStatus(emit, {
      sessionId,
      turnId,
      kind: normalizedKind,
      status: normalizedStatus,
      detail: detailFromItem(item)
    });
    emitActivity(emit, {
      sessionId,
      turnId,
      messageId,
      item,
      kind: normalizedKind,
      status: normalizedStatus
    });
    return;
  }

  if (detail) {
    emitStatus(emit, { sessionId, turnId, kind, status, detail });
  }
}

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

export async function runCodexTurn({
  sessionId,
  draftSessionId,
  projectPath,
  message,
  attachments = [],
  selectedSkills = [],
  model,
  reasoningEffort,
  permissionMode,
  turnId: providedTurnId
}, emit) {
  const { Codex } = await import('@openai/codex-sdk');
  const workingDirectory = await ensureAsciiWorkingDirectory(projectPath);
  const { sandboxMode, approvalPolicy } = mapPermissionMode(permissionMode);
  const feishuSkillKeys = detectFeishuSkillKeys(message);
  const normalizedReasoningEffort = normalizeReasoningEffort(reasoningEffort);
  const modelReasoningEffort =
    feishuSkillKeys.length && normalizedReasoningEffort === 'xhigh' ? 'low' : normalizedReasoningEffort;
  const larkCliContext = await buildCodexLarkCliContext(message).catch((error) => {
    console.warn('[lark-cli] Codex context disabled:', error.message);
    return { enabled: false, env: { ...process.env }, instruction: '' };
  });
  const abortController = new AbortController();
  const turnId = providedTurnId || crypto.randomUUID();
  const state = {
    hadAssistantText: false,
    failed: false,
    usage: null
  };
  const run = {
    thread: null,
    abortController,
    turnId,
    sessionId: sessionId || draftSessionId || null,
    previousSessionId: draftSessionId || sessionId || null,
    startedAt: new Date().toISOString(),
    status: 'running'
  };
  activeRuns.set(turnId, run);

  let currentSessionId = sessionId || null;
  let previousSessionId = draftSessionId || sessionId || null;
  let thread = null;
  let turnTimeoutTimer = null;
  let turnInactivityTimeoutTimer = null;
  let resetTurnInactivityTimeout = () => {};

  try {
    if (larkCliContext.enabled && larkCliContext.env) {
      larkCliContext.env.CODEXMOBILE_TURN_ID = turnId;
      larkCliContext.env.CODEXMOBILE_SESSION_ID = sessionId || draftSessionId || '';
    }
    const codex = new Codex({ env: larkCliContext.env || { ...process.env } });
    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model,
      modelReasoningEffort,
      ...(larkCliContext.enabled ? { networkAccessEnabled: true } : {})
    };

    thread = sessionId ? codex.resumeThread(sessionId, threadOptions) : codex.startThread(threadOptions);
    currentSessionId = thread.id || sessionId || `codex-${Date.now()}`;
    run.thread = thread;
    run.sessionId = currentSessionId;
    activeRuns.set(turnId, run);

    emit({
      type: 'chat-started',
      sessionId: currentSessionId,
      previousSessionId,
      turnId,
      projectPath,
      cwd: workingDirectory,
      startedAt: new Date().toISOString()
    });
    emitStatus(emit, { sessionId: currentSessionId, turnId, kind: 'reasoning', status: 'running', label: '正在思考' });

    const codexInput = [
      message,
      larkCliContext.enabled ? larkCliContext.instruction : ''
    ].filter(Boolean).join('\n\n');

    const turnInactivityTimeoutPromise = new Promise((_, reject) => {
      resetTurnInactivityTimeout = () => {
        if (turnInactivityTimeoutTimer) {
          clearTimeout(turnInactivityTimeoutTimer);
        }
        turnInactivityTimeoutTimer = setTimeout(
          () => reject(turnInactivityTimeoutError()),
          TURN_INACTIVITY_TIMEOUT_MS
        );
        if (typeof turnInactivityTimeoutTimer.unref === 'function') {
          turnInactivityTimeoutTimer.unref();
        }
      };
      resetTurnInactivityTimeout();
    });

    const turnTimeoutPromise = new Promise((_, reject) => {
      turnTimeoutTimer = setTimeout(() => reject(turnTimeoutError()), TURN_TIMEOUT_MS);
      if (typeof turnTimeoutTimer.unref === 'function') {
        turnTimeoutTimer.unref();
      }
    });

    const abortPromise = new Promise((_, reject) => {
      abortController.signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
    abortPromise.catch(() => {});

    const streamedTurn = await thread.runStreamed(codexInput, { signal: abortController.signal });

    const streamDonePromise = (async () => {
      for await (const event of streamedTurn.events) {
        resetTurnInactivityTimeout();
        const threadId = event.thread_id || event.id || event.payload?.id;
        if (event.type === 'thread.started' && threadId) {
          const fromSessionId = previousSessionId || currentSessionId;
          if (threadId !== currentSessionId) {
            currentSessionId = threadId;
            run.sessionId = threadId;
          }
          previousSessionId = fromSessionId;
          run.previousSessionId = fromSessionId;
          emit({
            type: 'thread-started',
            sessionId: threadId,
            previousSessionId: fromSessionId,
            turnId,
            projectPath,
            cwd: workingDirectory,
            startedAt: new Date().toISOString()
          });
          emitStatus(emit, { sessionId: threadId, turnId, kind: 'reasoning', status: 'running', label: '正在思考' });
          continue;
        }
        if (run.status === 'aborted') {
          break;
        }
        emitCodexEvent(event, currentSessionId, turnId, emit, state, run.startedAt);
      }
    })();

    await Promise.race([
      streamDonePromise,
      abortPromise,
      turnTimeoutPromise,
      turnInactivityTimeoutPromise
    ]);

    if (!state.failed) {
      const timing = turnTimingPayload(state.usage, {
        fallbackStartedAt: run.startedAt,
        fallbackCompletedAt: new Date().toISOString()
      });
      emit({
        type: 'chat-complete',
        sessionId: currentSessionId,
        previousSessionId,
        turnId,
        usage: state.usage,
        hadAssistantText: state.hadAssistantText,
        ...timing
      });
    }
  } catch (error) {
    const timedOut = isTurnTimeoutError(error);
    const inactiveTimedOut = isTurnInactivityTimeoutError(error);
    if (timedOut || inactiveTimedOut) {
      run.status = 'timeout';
      abortController.abort();
    }
    const wasAborted =
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted') ||
      activeRuns.get(turnId)?.status === 'aborted';
    const userError = timedOut
      ? `任务超过 ${formatTimeoutDuration(TURN_TIMEOUT_MS)} 没有完成，已自动中止。可以重新发送一次。`
      : inactiveTimedOut
        ? `任务超过 ${formatTimeoutDuration(TURN_INACTIVITY_TIMEOUT_MS)} 没有任何进度，已自动中止。可以重新发送一次。`
      : userFacingCodexError(error);

    emit({
      type: wasAborted ? 'chat-aborted' : 'chat-error',
      sessionId: currentSessionId,
      turnId,
      error: wasAborted ? null : userError
    });
    if (!wasAborted) {
      console.error('[codex] Chat error:', codexErrorDiagnostics(error));
      emitStatus(emit, {
        sessionId: currentSessionId,
        turnId,
        kind: 'turn',
        status: 'failed',
        label: '任务失败',
        detail: userError
      });
    }
  } finally {
    if (turnTimeoutTimer) {
      clearTimeout(turnTimeoutTimer);
    }
    if (turnInactivityTimeoutTimer) {
      clearTimeout(turnInactivityTimeoutTimer);
    }
    if (activeRuns.has(turnId)) {
      const activeRun = activeRuns.get(turnId);
      activeRun.status = activeRun.status === 'aborted' ? 'aborted' : 'completed';
      activeRuns.delete(turnId);
    }
  }

  return currentSessionId;
}

function runMatchesIdentifier(run, identifier) {
  return (
    Boolean(identifier) &&
    (run.turnId === identifier || run.sessionId === identifier || run.previousSessionId === identifier)
  );
}

export function abortCodexTurn(identifier) {
  const id = String(identifier || '').trim();
  const runs = [...activeRuns.values()].filter(
    (run) => run.status === 'running' && runMatchesIdentifier(run, id)
  );
  if (!runs.length) {
    return false;
  }
  for (const run of runs) {
    run.status = 'aborted';
    run.abortController.abort();
  }
  return true;
}

export function getActiveRuns() {
  return [...activeRuns.values()]
    .filter((run) => run.status === 'running')
    .map((run) => ({
      sessionId: run.sessionId,
      previousSessionId: run.previousSessionId,
      startedAt: run.startedAt,
      status: run.status,
      turnId: run.turnId
    }));
}
