/**
 * 读取 rollout/session JSONL，拼装消息列表、分页与运行时活动投影入口。
 *
 * Keywords: session-messages, rollout-jsonl, pagination
 *
 * Exports:
 * - messagesFromRolloutJsonl / publicContextState / publicRuntimeState — 解析与脱敏视图。
 * - readRolloutContextState / paginateMessages / isoFromEpochSeconds — IO 与分页工具。
 * - createSessionMessageReader — 可注入 fs 与会话依赖的读数器。
 *
 * Inward（本模块依赖/组装的关键符号）: session-message-reader 内部 JSONL 解析。
 *
 * Outward（谁在用/调用场景）: codex-data.readSessionMessages、API 层。
 *
 * 不负责: 写入会话文件。
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import readline from 'node:readline';
import {
  readRawSessionActivities as defaultReadRawSessionActivities
} from './desktop-activity-parser.js';
import {
  extractProposedPlanContent,
  implementedPlanContentFromMessage,
  implementedPlanContentsMatch,
  isInternalUserInput,
  planMessageFromContent,
  planRequestMessageFromContent,
  removeDuplicateGuidedUserSegments,
  removeFallbackActivitiesCoveredByRaw as defaultRemoveFallbackActivitiesCoveredByRaw,
  sanitizeVisibleUserMessage,
  sortDesktopActivitySteps as defaultSortDesktopActivitySteps,
  upsertDesktopActivity as defaultUpsertDesktopActivity
} from './desktop-thread-projector.js';
import {
  filterDeletedMessages as defaultFilterDeletedMessages,
  readDeletedMessageIds as defaultReadDeletedMessageIds
} from './session-local-state.js';

const ROLLOUT_CONTEXT_READ_BYTES = Math.max(
  64 * 1024,
  Number(process.env.CODEXMOBILE_ROLLOUT_CONTEXT_READ_BYTES) || 1024 * 1024
);
const GUIDED_USER_LABEL = '已引导对话';

function guidedUserMetadata(enabled) {
  return enabled
    ? {
      guided: true,
      guideLabel: GUIDED_USER_LABEL,
      kind: 'guided_user'
    }
    : {};
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function epochSecondsFromIso(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms / 1000 : null;
}

function responseMessageText(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => item?.text || item?.content || '')
    .filter(Boolean)
    .join('')
    .trim();
}

function ensureRolloutTurn(turns, sessionId, timestamp) {
  if (turns.length) {
    return turns.at(-1);
  }
  const turn = {
    id: `${sessionId}-turn-1`,
    startedAt: epochSecondsFromIso(timestamp)
  };
  turns.push(turn);
  return turn;
}

function upsertRolloutTurn(turns, sessionId, turnId, timestamp) {
  const id = String(turnId || '').trim() || `${sessionId}-turn-${turns.length + 1}`;
  const existing = turns.find((turn) => turn.id === id);
  if (existing) {
    if (!existing.startedAt) {
      existing.startedAt = epochSecondsFromIso(timestamp);
    }
    return existing;
  }
  const turn = {
    id,
    startedAt: epochSecondsFromIso(timestamp)
  };
  turns.push(turn);
  return turn;
}

export function messagesFromRolloutJsonl(content, sessionId) {
  const messages = [];
  const turns = [];
  const userCountsByTurn = new Map();
  const lines = String(content || '').split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const timestamp = entry.timestamp || new Date().toISOString();
    if (entry.type === 'event_msg' && entry.payload?.type === 'task_started') {
      upsertRolloutTurn(turns, sessionId, entry.payload?.turn_id, timestamp);
      continue;
    }
    if (entry.type === 'turn_context') {
      upsertRolloutTurn(turns, sessionId, entry.payload?.turn_id, timestamp);
      continue;
    }
    if (entry.type !== 'response_item' || entry.payload?.type !== 'message') {
      continue;
    }
    const role = entry.payload.role;
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }
    if (role === 'assistant' && entry.payload.phase === 'commentary') {
      continue;
    }
    const contentText = responseMessageText(entry.payload.content);
    if (!contentText) {
      continue;
    }
    if (role === 'user' && isInternalUserInput(contentText)) {
      continue;
    }
    const implementedPlanContent = role === 'user' ? implementedPlanContentFromMessage(contentText) : '';
    if (implementedPlanContent) {
      removeImplementedPlanRequests(messages, implementedPlanContent);
    }
    const turn = ensureRolloutTurn(turns, sessionId, timestamp);
    let userIndex = -1;
    if (role === 'user') {
      userIndex = userCountsByTurn.get(turn.id) || 0;
      userCountsByTurn.set(turn.id, userIndex + 1);
    }
    const userMetadata = role === 'user'
      ? {
        segmentIndex: userIndex,
        ...guidedUserMetadata(userIndex > 0)
      }
      : {};
    if (role === 'assistant') {
      const proposedPlan = extractProposedPlanContent(contentText);
      if (proposedPlan) {
        const baseId = entry.payload.id || `${turn.id}-assistant-${messages.length + 1}`;
        const planMessage = planMessageFromContent({
          id: `${baseId}-plan`,
          content: proposedPlan,
          timestamp,
          turnId: turn.id,
          sessionId
        });
        const requestMessage = planRequestMessageFromContent({
          id: `${baseId}-plan-request`,
          requestId: `implement-plan:${turn.id}`,
          content: proposedPlan,
          timestamp,
          turnId: turn.id,
          sessionId
        });
        if (planMessage) {
          messages.push(planMessage);
        }
        if (requestMessage) {
          messages.push(requestMessage);
        }
        continue;
      }
    }
    messages.push({
      id: entry.payload.id || `${turn.id}-${role}-${messages.length + 1}`,
      role,
      content: role === 'user' ? sanitizeVisibleUserMessage(contentText) : contentText,
      ...userMetadata,
      timestamp,
      turnId: turn.id,
      sessionId
    });
  }

  return { messages: removeStalePlanRequestsAfterUserMessages(removeDuplicateGuidedUserSegments(messages)), turns };
}

function removeStalePlanRequestsAfterUserMessages(messages) {
  return messages.filter((message, index) => {
    if (message?.role !== 'plan_request') {
      return true;
    }
    return !messages.slice(index + 1).some((nextMessage) => nextMessage?.role === 'user');
  });
}

function removeImplementedPlanRequests(messages, implementedPlanContent) {
  const normalizedImplemented = String(implementedPlanContent || '').replace(/\s+/g, ' ').trim();
  if (!normalizedImplemented) {
    return;
  }
  const implementedSet = new Set([normalizedImplemented]);
  if (implementedPlanContentsMatch(implementedSet, '')) {
    const latestRequest = messages
      .map((message, messageIndex) => ({ message, messageIndex }))
      .reverse()
      .find(({ message }) => message.role === 'plan_request' && !message.planImplementation?.completed);
    if (latestRequest) {
      messages.splice(latestRequest.messageIndex, 1);
    }
    return;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === 'plan_request' &&
      implementedPlanContentsMatch(implementedSet, message.planImplementation?.planContent)
    ) {
      messages.splice(index, 1);
    }
  }
}

function contextStateFromJsonlContent(content, sessionId) {
  const state = { sessionId, runtime: null };
  let start = 0;
  if (content.length > ROLLOUT_CONTEXT_READ_BYTES) {
    const skip = content.length - ROLLOUT_CONTEXT_READ_BYTES;
    const nextNewline = content.indexOf('\n', skip);
    start = nextNewline === -1 ? skip : nextNewline + 1;
  }
  const text = start > 0 ? content.slice(start) : content;
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      applyContextEntry(state, JSON.parse(line), sessionId);
    } catch {
      // Skip malformed or partial JSONL rows.
    }
  }
  return state;
}

async function readRolloutThreadFromFile(filePath, sessionId) {
  if (!filePath) {
    return null;
  }
  const content = await fs.readFile(filePath, 'utf8');
  const parsed = messagesFromRolloutJsonl(content, sessionId);
  return {
    id: sessionId,
    path: filePath,
    turns: parsed.turns,
    messages: parsed.messages,
    _contextContent: content
  };
}

function activityContainerStatusForRuntime(item = {}, contextState = {}) {
  const runtime = contextState?.runtime || null;
  if (!runtime || !item?.turnId) {
    return '';
  }
  if (runtime.turnId !== item.turnId) {
    return '';
  }
  return runtime.status || '';
}

export function publicContextState(state = {}, configContext = {}) {
  const contextWindow = state.contextWindow || configContext.modelContextWindow || null;
  const inputTokens = state.inputTokens || null;
  const autoCompactLimit = configContext.autoCompactTokenLimit || null;
  const percent =
    inputTokens && contextWindow
      ? Math.max(0, Math.min(100, Math.round((inputTokens / contextWindow) * 1000) / 10))
      : null;
  const compactDetected = Boolean(state.autoCompactDetected);
  return {
    sessionId: state.sessionId || null,
    model: state.model || null,
    inputTokens,
    totalTokens: state.totalTokens || null,
    contextWindow,
    percent,
    lastTokenUsage: state.lastTokenUsage || null,
    totalTokenUsage: state.totalTokenUsage || null,
    updatedAt: state.updatedAt || null,
    autoCompact: {
      enabled: Boolean(autoCompactLimit || configContext.autoCompactEnabled),
      tokenLimit: autoCompactLimit,
      detected: compactDetected,
      status: compactDetected ? 'detected' : (autoCompactLimit || configContext.autoCompactEnabled) ? 'watching' : 'unknown',
      lastCompactedAt: state.autoCompactLastAt || null,
      reason: state.autoCompactReason || ''
    }
  };
}

export function publicRuntimeState(runtime = null, sessionId = '') {
  if (runtime?.status !== 'running') {
    return null;
  }
  return {
    status: 'running',
    source: runtime.source || 'desktop-thread',
    sessionId: runtime.sessionId || sessionId || null,
    turnId: runtime.turnId || null,
    startedAt: runtime.startedAt || null,
    updatedAt: runtime.updatedAt || null,
    steerable: runtime.steerable === true
  };
}

function tokenUsageFromPayload(payload) {
  const info = payload?.info && typeof payload.info === 'object' ? payload.info : {};
  const last = info.last_token_usage && typeof info.last_token_usage === 'object' ? info.last_token_usage : {};
  const total = info.total_token_usage && typeof info.total_token_usage === 'object' ? info.total_token_usage : {};
  return {
    inputTokens: positiveNumber(last.input_tokens ?? total.input_tokens),
    totalTokens: positiveNumber(total.total_tokens ?? last.total_tokens),
    contextWindow: positiveNumber(info.model_context_window ?? payload?.model_context_window),
    lastTokenUsage: last,
    totalTokenUsage: total
  };
}

function isoFromEpochValue(value, fallback = null) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString();
  }
  return fallback;
}

function markRuntimeRunning(state, { turnId, timestamp, startedAt = null } = {}) {
  const id = String(turnId || '').trim();
  if (!id) {
    return;
  }
  const startedAtIso = isoFromEpochValue(startedAt, timestamp || new Date().toISOString());
  state.runtime = {
    status: 'running',
    source: 'desktop-thread',
    sessionId: state.sessionId || null,
    turnId: id,
    startedAt: startedAtIso,
    updatedAt: timestamp || startedAtIso || new Date().toISOString(),
    steerable: false
  };
}

function clearRuntimeForTurn(state, turnId) {
  if (!state.runtime) {
    return;
  }
  const id = String(turnId || '').trim();
  if (!id || state.runtime.turnId === id) {
    state.runtime = null;
  }
}

function applyContextEntry(state, entry, sessionId) {
  const payload = entry?.payload || {};
  const timestamp = entry?.timestamp || new Date().toISOString();
  const type = payload.type || '';

  if (entry.type === 'turn_context') {
    markRuntimeRunning(state, { turnId: payload.turn_id, timestamp });
    const summary = String(payload.summary || '').trim();
    if (summary && summary !== 'none') {
      state.autoCompactDetected = true;
      state.autoCompactLastAt = timestamp;
      state.autoCompactReason = '会话已带摘要继续';
    }
    if (payload.model) {
      state.model = payload.model;
    }
    state.updatedAt = timestamp;
    return;
  }

  if (
    entry.type === 'response_item' &&
    payload.type === 'message' &&
    payload.role === 'assistant' &&
    payload.phase !== 'commentary'
  ) {
    clearRuntimeForTurn(state, state.runtime?.turnId);
    state.updatedAt = timestamp;
    return;
  }

  if (entry.type === 'compacted') {
    state.autoCompactDetected = true;
    state.autoCompactLastAt = timestamp;
    state.autoCompactReason = '上下文已自动压缩';
    state.updatedAt = timestamp;
    return;
  }

  if (entry.type !== 'event_msg') {
    return;
  }

  if (type === 'task_started') {
    markRuntimeRunning(state, {
      turnId: payload.turn_id,
      timestamp,
      startedAt: payload.started_at
    });
    state.contextWindow = positiveNumber(payload.model_context_window) || state.contextWindow || null;
    state.updatedAt = timestamp;
    return;
  }

  if (/^task_(complete|failed|aborted|cancelled|canceled)$/.test(type) || /^turn_(complete|failed|aborted|cancelled|canceled)$/.test(type)) {
    clearRuntimeForTurn(state, payload.turn_id);
    state.updatedAt = timestamp;
    return;
  }

  if (type !== 'token_count') {
    return;
  }

  const usage = tokenUsageFromPayload(payload);
  const previousInputTokens = state.inputTokens;
  state.sessionId = sessionId;
  state.inputTokens = usage.inputTokens || state.inputTokens || null;
  state.totalTokens = usage.totalTokens || state.totalTokens || null;
  state.contextWindow = usage.contextWindow || state.contextWindow || null;
  state.lastTokenUsage = usage.lastTokenUsage;
  state.totalTokenUsage = usage.totalTokenUsage;
  state.updatedAt = timestamp;

  if (
    previousInputTokens &&
    usage.inputTokens &&
    previousInputTokens > 20000 &&
    usage.inputTokens < previousInputTokens * 0.62
  ) {
    state.autoCompactDetected = true;
    state.autoCompactLastAt = timestamp;
    state.autoCompactReason = '上下文用量回落';
  }
}

export async function readRolloutContextState(filePath, sessionId) {
  const state = { sessionId, runtime: null };
  if (!filePath) {
    return state;
  }

  let start = 0;
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > ROLLOUT_CONTEXT_READ_BYTES) {
      start = stats.size - ROLLOUT_CONTEXT_READ_BYTES;
    }
  } catch {
    return state;
  }

  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8', start });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      try {
        applyContextEntry(state, JSON.parse(line), sessionId);
      } catch {
        // Skip malformed or partial JSONL rows.
      }
    }
  } catch {
    return state;
  }
  return state;
}

export function paginateMessages(messages, { limit = 120, offset = null, latest = true } = {}) {
  const total = messages.length;
  const count = Number(limit) || 0;
  const hasOffset = offset !== null && offset !== undefined;
  const start = hasOffset
    ? Math.max(0, Number(offset) || 0)
    : latest && count
      ? Math.max(0, total - count)
      : 0;
  const end = count ? start + count : undefined;
  return {
    messages: messages.slice(start, end),
    total,
    offset: start,
    hasMore: end ? end < total : false,
    hasMoreBefore: start > 0
  };
}

function messageTimestampValue(message) {
  const value = Date.parse(message?.timestamp || '');
  return Number.isFinite(value) ? value : 0;
}

function sortMessagesByConversationOrder(messages) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTurnId = left.message?.turnId || '';
      const rightTurnId = right.message?.turnId || '';
      if (leftTurnId && leftTurnId === rightTurnId) {
        return left.index - right.index;
      }
      const timestampDelta = messageTimestampValue(left.message) - messageTimestampValue(right.message);
      return timestampDelta || left.index - right.index;
    })
    .map((item) => item.message);
}

function messageTurnIds(messages = []) {
  return new Set(
    (Array.isArray(messages) ? messages : [])
      .map((message) => String(message?.turnId || '').trim())
      .filter(Boolean)
  );
}

export function isoFromEpochSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

export function createSessionMessageReader({
  readDeletedMessageIds = defaultReadDeletedMessageIds,
  readRawSessionActivities = defaultReadRawSessionActivities,
  removeFallbackActivitiesCoveredByRaw = defaultRemoveFallbackActivitiesCoveredByRaw,
  upsertDesktopActivity = defaultUpsertDesktopActivity,
  sortDesktopActivitySteps = defaultSortDesktopActivitySteps,
  filterDeletedMessages = defaultFilterDeletedMessages,
  readRolloutContextState: readRolloutContextStateImpl = readRolloutContextState,
  resolveSessionThread = async () => null,
  getConfigContext = () => ({})
} = {}) {
  async function readThread(sessionId) {
    const session = await resolveSessionThread(sessionId);
    const filePath = session?.filePath || session?.path || '';
    const thread = await readRolloutThreadFromFile(filePath, sessionId).catch(() => null);
    if (thread) {
      return thread;
    }
    const error = new Error('Session thread not found');
    error.statusCode = 404;
    throw error;
  }

  async function readSessionMessages(
    sessionId,
    { limit = 120, offset = null, latest = true, includeActivity = false } = {}
  ) {
    const deletedIds = await readDeletedMessageIds(sessionId);
    const thread = await readThread(sessionId);

    const baseMessages = Array.isArray(thread.messages)
      ? thread.messages.map((message) => ({ ...message }))
      : [];
    const contextState = thread._contextContent
      ? contextStateFromJsonlContent(thread._contextContent, sessionId)
      : await readRolloutContextStateImpl(thread.path, sessionId);
    thread._contextContent = null;
    const orderedBaseMessages = sortMessagesByConversationOrder(filterDeletedMessages(baseMessages, deletedIds));
    const page = paginateMessages(orderedBaseMessages, { limit, offset, latest });

    let messages = page.messages.map((message) => ({ ...message }));
    if (includeActivity) {
      const visibleTurnIds = messageTurnIds(messages);
      if (contextState?.runtime?.turnId) {
        visibleTurnIds.add(String(contextState.runtime.turnId));
      }
      const activityOptions = visibleTurnIds.size ? { turnIds: visibleTurnIds } : {};
      const rawActivities = await readRawSessionActivities(thread.path, thread.turns || [], activityOptions);
      removeFallbackActivitiesCoveredByRaw(messages, rawActivities);
      for (const item of rawActivities) {
        upsertDesktopActivity(
          messages,
          item.turnId,
          item.activity,
          item.segmentIndex,
          activityContainerStatusForRuntime(item, contextState),
          thread.id || sessionId
        );
      }
      messages.splice(0, messages.length, ...removeDuplicateGuidedUserSegments(messages));
      sortDesktopActivitySteps(messages);
    }
    const orderedMessages = sortMessagesByConversationOrder(filterDeletedMessages(messages, deletedIds));

    return {
      ...page,
      messages: orderedMessages,
      context: publicContextState(contextState, getConfigContext() || {})
    };
  }

  return { readSessionMessages };
}
