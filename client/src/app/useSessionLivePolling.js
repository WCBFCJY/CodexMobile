/**
 * 定时拉取选中会话消息并做轻量合并，作为 WebSocket live events 的补账层。
 *
 * Keywords: live-polling, session-messages, reconcile
 *
 * Exports:
 * - `useSessionLivePolling` — 基于认证与选中会话驱动轮询的 effect hook。
 *
 * Inward: `api`、`session-live-refresh`、`activity-model` 签名、`session-utils`。
 *
 * Outward: `App.jsx` 与会话实时展示链路配合。
 */

import { useEffect } from 'react';
import { apiFetch } from '../api.js';
import {
  messageStreamSignature
} from '../chat/activity-model.js';
import {
  hasStaleRunningActivityResolvedByLoaded,
  mergeLiveSelectedThreadMessages
} from '../session-live-refresh.js';
import { mergeContextStatus } from './context-status.js';
import {
  isDraftSession,
  sessionMessagesApiPath
} from './session-utils.js';

export function useSessionLivePolling({
  authenticated,
  selectedSession,
  hasRunningActivity,
  running,
  defaultStatus,
  sessionLivePollRef,
  selectedSessionRef,
  messagesRef,
  clearRun,
  markSessionCompleteNotice,
  setContextStatus,
  setMessages
}) {
  useEffect(() => {
    if (!authenticated || !selectedSession?.id || isDraftSession(selectedSession)) {
      return undefined;
    }

    const sessionId = selectedSession.id;
    let stopped = false;
    async function pollSelectedSession() {
      if (stopped || sessionLivePollRef.current) {
        return;
      }
      sessionLivePollRef.current = true;
      try {
        const data = await apiFetch(sessionMessagesApiPath(sessionId));
        if (!stopped && selectedSessionRef.current?.id === sessionId && Array.isArray(data.messages)) {
          const currentMessages = Array.isArray(messagesRef?.current) ? messagesRef.current : [];
          const forceDropStaleRunning = hasStaleRunningActivityResolvedByLoaded(currentMessages, data.messages);
          if (forceDropStaleRunning) {
            const assistant = [...data.messages].reverse().find((message) => message?.role === 'assistant');
            const completedAt = assistant?.completedAt || assistant?.timestamp || new Date().toISOString();
            const payload = {
              sessionId,
              turnId: selectedSessionRef.current?.turnId || '',
              completedAt,
              timestamp: completedAt
            };
            markSessionCompleteNotice?.(payload);
            clearRun?.(payload);
          }
          setContextStatus((current) => mergeContextStatus(current, data.context || defaultStatus.context, defaultStatus.context));
          setMessages((current) =>
            messageStreamSignature(current) === messageStreamSignature(data.messages)
              ? current
              : mergeLiveSelectedThreadMessages(current, data.messages, { forceDropStaleRunning })
          );
        }
      } catch {
        // Keep the currently rendered conversation if a transient poll fails.
      } finally {
        sessionLivePollRef.current = false;
      }
    }

    const intervalMs = hasRunningActivity || running ? 700 : 1600;
    const timer = window.setInterval(pollSelectedSession, intervalMs);
    pollSelectedSession();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [
    authenticated,
    selectedSession?.id,
    hasRunningActivity,
    running
  ]);
}
