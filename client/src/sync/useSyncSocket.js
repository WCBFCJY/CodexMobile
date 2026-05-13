/**
 * 统一同步 WebSocket 消费器：优先处理 sync-event/sync-state，并把旧 UI 直连降级为兼容层。
 *
 * Keywords: sync-socket, websocket, runtime, messages, reducer
 *
 * Exports:
 * - applySyncSocketPayload — 在 useAppWebSocket 中消费统一同步 payload。
 *
 * Inward（本模块依赖/组装的关键符号）: sync-reducer、activity-model、message-identity、context-status。
 *
 * Outward（谁在用/调用场景）: app/useAppWebSocket.js。
 *
 * 不负责: 建立 WebSocket 连接。
 */

import {
  applySyncRuntimeEvent,
  isSyncRunningEvent,
  isSyncTerminalEvent,
  mergeSyncStateRuntime,
  sessionMatchesSyncEvent,
  syncEventRunKeys
} from './sync-reducer.js';
import {
  upsertActivityMessage,
  upsertAssistantMessage,
  upsertStatusMessage
} from '../chat/activity-model.js';
import { sameUserMessageContent } from '../chat/message-identity.js';
import { mergeContextStatus } from '../app/context-status.js';

function syncEventPayloadForLegacy(event = {}) {
  return {
    source: event.source || null,
    projectId: event.projectId || null,
    sessionId: event.sessionId || null,
    previousSessionId: event.previousSessionId || null,
    draftSessionId: event.draftSessionId || null,
    turnId: event.turnId || event.clientTurnId || null,
    clientTurnId: event.clientTurnId || null,
    status: event.status || null,
    label: event.label || null,
    detail: event.detail || null,
    startedAt: event.startedAt || null,
    completedAt: event.completedAt || null,
    timestamp: event.timestamp || new Date().toISOString()
  };
}

function syncEventMatchesCurrent(event, selectedSessionRef) {
  return sessionMatchesSyncEvent(selectedSessionRef.current, event);
}

function applyRuntimeStateFromSnapshot(state, { setThreadRuntimeById, setRunningById, runningByIdRef }) {
  if (!state || typeof state !== 'object') {
    return;
  }
  setThreadRuntimeById((current) => mergeSyncStateRuntime(current, state));
  if (state.runtimeById && typeof state.runtimeById === 'object') {
    const nextRunning = {};
    for (const [key, runtime] of Object.entries(state.runtimeById)) {
      if (runtime?.status === 'running' || runtime?.status === 'queued') {
        nextRunning[key] = true;
      }
    }
    setRunningById(() => {
      runningByIdRef.current = nextRunning;
      return nextRunning;
    });
  }
}

function clearRuntimeForEvent(event, { clearRun, setThreadRuntimeById }) {
  const payload = syncEventPayloadForLegacy(event);
  clearRun(payload);
  setThreadRuntimeById((current) => applySyncRuntimeEvent(current, event));
}

export function applySyncSocketPayload(payload, context) {
  if (payload?.type === 'sync-state') {
    applyRuntimeStateFromSnapshot(payload.state, context);
    return true;
  }
  if (payload?.type !== 'sync-event' || !payload.event) {
    return false;
  }

  const { event } = payload;
  const legacyPayload = syncEventPayloadForLegacy(event);

  if (payload.state) {
    applyRuntimeStateFromSnapshot(payload.state, context);
  }

  if (isSyncRunningEvent(event)) {
    context.markRun(legacyPayload);
    context.setThreadRuntimeById((current) => applySyncRuntimeEvent(current, event));
    return true;
  }

  if (isSyncTerminalEvent(event)) {
    context.markSessionCompleteNotice(legacyPayload);
    clearRuntimeForEvent(event, context);
    if (syncEventMatchesCurrent(event, context.selectedSessionRef)) {
      if (event.eventType === 'turn.failed') {
        context.setMessages((current) =>
          upsertStatusMessage(current, {
            ...legacyPayload,
            kind: 'turn',
            status: 'failed',
            label: '任务失败',
            detail: event.detail || '任务失败'
          })
        );
      } else if (event.eventType === 'turn.aborted') {
        context.setMessages((current) =>
          upsertStatusMessage(current, {
            ...legacyPayload,
            kind: 'turn',
            status: 'completed',
            label: '已中止'
          })
        );
      } else if (event.sessionId || event.turnId) {
        context.scheduleTurnRefresh(legacyPayload);
      }
    }
    return true;
  }

  if (event.eventType === 'thread.started' && event.sessionId) {
    const projectId = event.projectId || context.selectedProjectRef?.current?.id || context.selectedSessionRef.current?.projectId;
    const currentSession = context.selectedSessionRef.current;
    const nextSession = {
      ...(currentSession || {}),
      ...(event.session || {}),
      id: event.sessionId,
      projectId,
      title: event.session?.title || currentSession?.title || '新对话',
      turnId: event.turnId || currentSession?.turnId || null,
      updatedAt: event.timestamp || new Date().toISOString(),
      draft: false
    };
    const shouldReplace =
      !currentSession ||
      currentSession.id === event.previousSessionId ||
      currentSession.id === event.sessionId ||
      currentSession.turnId === event.turnId ||
      (currentSession.draft && currentSession.projectId === projectId);
    if (shouldReplace) {
      context.selectedSessionRef.current = nextSession;
      context.setSelectedSession?.((current) => (current ? { ...current, ...nextSession } : nextSession));
    }
    if (projectId && context.upsertSessionInProject) {
      context.setSessionsByProject?.((current) =>
        context.upsertSessionInProject(current, projectId, nextSession, event.previousSessionId)
      );
    }
    context.setMessages?.((current) =>
      current.map((message) =>
        message.turnId === event.turnId || message.sessionId === event.previousSessionId
          ? { ...message, sessionId: event.sessionId }
          : message
      )
    );
    return true;
  }

  if (event.eventType === 'message.user' && event.message && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    context.setMessages((current) => {
      const exists = current.some((message) =>
        message.role === 'user' && sameUserMessageContent(message.content, event.message.content)
      );
      return exists ? current : [...current, event.message];
    });
    return true;
  }

  if (event.eventType === 'message.deleted' && event.messageId && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    context.setMessages((current) => current.filter((message) => String(message.id) !== String(event.messageId)));
    return true;
  }

  if (event.eventType?.startsWith('message.assistant') && event.message && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    if (String(event.message.content || '').trim()) {
      context.setMessages((current) => upsertAssistantMessage(current, {
        ...legacyPayload,
        ...event.message,
        content: event.message.content,
        done: event.message.done
      }));
    }
    return true;
  }

  if (event.eventType?.startsWith('activity.') && event.activity && !event.suppressedInChat && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    context.setMessages((current) => upsertActivityMessage(current, event.activity));
    return true;
  }

  if (event.eventType === 'context.updated' && event.context && syncEventMatchesCurrent(event, context.selectedSessionRef)) {
    context.setContextStatus((current) => mergeContextStatus(current, event.context, context.defaultStatus.context));
    return true;
  }

  if (event.eventType === 'sessions.synced') {
    if (Array.isArray(event.projects)) {
      context.setProjects(event.projects);
    }
    return true;
  }

  if (event.eventType === 'thread.renamed') {
    context.handleThreadRenamed?.(event);
    return true;
  }

  return true;
}

export function syncEventHasRunKeys(event = {}) {
  return syncEventRunKeys(event).length > 0;
}
