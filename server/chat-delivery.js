/**
 * 聊天投递层：桌面桥校验、Unix/socket IPC 送信与无桌面时的 headless 队列。
 *
 * Keywords: desktop-ipc, headless-codex, bridge, codex-turn-input
 *
 * Exports:
 * - assertDesktopBridgeAvailable — 校验桌面桥是否可用。
 * - desktopIpcCanUseBackgroundFallback — 是否允许后台 fallback。
 * - backgroundFallbackBridge — 构造 fallback descriptors。
 * - sendViaDesktopIpc — 经桌面转发用户回合。
 * - runQueuedHeadlessChatJob — 排队执行后台 Codex。
 *
 * Inward（本模块依赖/组装的关键符号）: codex-native-images（buildCodexTurnInput）、desktop-ipc-client、codex-runner。
 *
 * Outward（谁在用/调用场景）: chat-service。
 *
 * 不负责: HTTP 层与路由注册。
 */
import { buildCodexTurnInput } from './codex-native-images.js';

export async function assertDesktopBridgeAvailable(getDesktopBridgeStatus) {
  const bridge = getDesktopBridgeStatus ? await getDesktopBridgeStatus({ force: true }) : null;
  if (bridge && !bridge.connected) {
    const error = new Error(bridge.reason || '桌面端 Codex 未连接，无法发送消息。');
    error.statusCode = 503;
    error.code = 'CODEXMOBILE_DESKTOP_BRIDGE_UNAVAILABLE';
    throw error;
  }
  return bridge;
}

function desktopIpcUnavailableError(message = '桌面端 Codex 已连接，但当前线程没有可接管的桌面窗口。') {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = 'CODEXMOBILE_DESKTOP_THREAD_OWNER_UNAVAILABLE';
  return error;
}

function desktopCreateThreadUnavailableError() {
  const error = new Error('当前桌面端 Codex 只开放了接管已有对话，不能从手机直接新建桌面端对话。请先在桌面端新建或打开一个对话，再从手机继续发送。');
  error.statusCode = 409;
  error.code = 'CODEXMOBILE_DESKTOP_CREATE_THREAD_UNAVAILABLE';
  return error;
}

function isDesktopFollowerHandoffTimeout(error) {
  if (error?.code !== 'CODEXMOBILE_DESKTOP_IPC_TIMEOUT') {
    return false;
  }
  return /thread-follower-(?:set-model-and-reasoning|set-collaboration-mode|start-turn|steer-turn|interrupt-turn)\b/.test(String(error.message || ''));
}

function isDesktopThreadOwnerUnavailable(error) {
  return (
    error?.message === 'no-client-found' ||
    error?.statusCode === 409 ||
    isDesktopFollowerHandoffTimeout(error)
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelays(value) {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item >= 0)
    : [];
}

export function desktopIpcCanUseBackgroundFallback(bridge) {
  return Boolean(
    bridge?.capabilities?.backgroundCodex ||
    bridge?.capabilities?.headless ||
    bridge?.capabilities?.createThreadViaBackground
  );
}

export function backgroundFallbackBridge(bridge, reason = '桌面端当前没有接管这个线程，已改用后台 Codex 执行。') {
  return {
    ...(bridge || {}),
    strict: false,
    connected: true,
    mode: 'headless-local',
    reason,
    capabilities: {
      ...(bridge?.capabilities || {}),
      read: true,
      sendToOpenDesktopThread: false,
      createThread: true,
      headless: true,
      backgroundCodex: true
    }
  };
}

function userMessageMetadataForSendMode(sendMode = 'start') {
  return sendMode === 'steer'
    ? {
      guided: true,
      guideLabel: '已引导对话',
      kind: 'guided_user'
    }
    : {};
}

async function syncDesktopFollowerCollaborationMode({
  selectedSessionId,
  collaborationMode,
  setDesktopFollowerCollaborationMode,
  desktopIpcTimeoutMs
}) {
  if (!setDesktopFollowerCollaborationMode) {
    return;
  }
  await setDesktopFollowerCollaborationMode(selectedSessionId, collaborationMode || null, {
    timeoutMs: desktopIpcTimeoutMs
  });
}

export async function sendViaDesktopIpc({
  bridge,
  project,
  selectedSessionId,
  draftSessionId,
  turnId,
  sendMode,
  codexMessage,
  visibleMessage,
  attachments,
  selectedSkills,
  model,
  reasoningEffort,
  serviceTier,
  permissionMode,
  collaborationMode,
  getSession,
  rememberTurn,
  broadcast,
  setDesktopFollowerModelAndReasoning,
  setDesktopFollowerCollaborationMode,
  steerDesktopFollowerTurn,
  startDesktopFollowerTurn,
  interruptDesktopFollowerTurn,
  desktopOwnerRetryDelays = [],
  desktopIpcTimeoutMs = 6000,
  sleep = wait
}) {
  if (!selectedSessionId) {
    throw desktopCreateThreadUnavailableError();
  }

  const input = buildCodexTurnInput({
    message: codexMessage,
    attachments,
    selectedSkills
  });
  const now = new Date().toISOString();
  const lastSession = getSession(selectedSessionId);
  const baseTurnStartParams = {
    input,
    cwd: lastSession?.cwd || project.path || null,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxPolicy: permissionMode === 'bypassPermissions'
      ? { type: 'dangerFullAccess' }
      : { type: 'workspaceWrite', networkAccess: false },
    model: model || null,
    effort: reasoningEffort || null,
    serviceTier: serviceTier || null,
    collaborationMode: collaborationMode || null,
    attachments: []
  };

  async function attemptDesktopFollowerTurn() {
    if (sendMode === 'steer') {
      if (setDesktopFollowerModelAndReasoning) {
        await setDesktopFollowerModelAndReasoning(selectedSessionId, model || null, reasoningEffort || null, {
          timeoutMs: desktopIpcTimeoutMs
        });
      }
      await syncDesktopFollowerCollaborationMode({
        selectedSessionId,
        collaborationMode,
        setDesktopFollowerCollaborationMode,
        desktopIpcTimeoutMs
      });
      result = await steerDesktopFollowerTurn(selectedSessionId, {
        input,
        attachments: [],
        restoreMessage: {
          text: codexMessage,
          cwd: lastSession?.cwd || project.path || null,
          context: {
            workspaceRoots: project.path ? [project.path] : [],
            collaborationMode: collaborationMode || null
          },
          responsesapiClientMetadata: null
        }
      }, { timeoutMs: desktopIpcTimeoutMs });
    } else {
      if (sendMode === 'interrupt') {
        await interruptDesktopFollowerTurn(selectedSessionId, { timeoutMs: desktopIpcTimeoutMs });
      }
      if (setDesktopFollowerModelAndReasoning) {
        await setDesktopFollowerModelAndReasoning(selectedSessionId, model || null, reasoningEffort || null, {
          timeoutMs: desktopIpcTimeoutMs
        });
      }
      await syncDesktopFollowerCollaborationMode({
        selectedSessionId,
        collaborationMode,
        setDesktopFollowerCollaborationMode,
        desktopIpcTimeoutMs
      });
      result = await startDesktopFollowerTurn(selectedSessionId, baseTurnStartParams, { timeoutMs: desktopIpcTimeoutMs });
    }
    return result;
  }

  let result;
  const ownerRetryDelays = retryDelays(desktopOwnerRetryDelays);
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        result = await attemptDesktopFollowerTurn();
        break;
      } catch (error) {
        if (!isDesktopThreadOwnerUnavailable(error) || attempt >= ownerRetryDelays.length) {
          throw error;
        }
        const delay = ownerRetryDelays[attempt] || 0;
        if (delay > 0) {
          await sleep(delay);
        }
      }
    }
  } catch (error) {
    if (isDesktopThreadOwnerUnavailable(error)) {
      throw desktopIpcUnavailableError(error?.message || undefined);
    }
    throw error;
  }

  const appTurnId = result?.result?.turn?.id || result?.turn?.id || turnId;
  rememberTurn(turnId, {
    projectId: project.id,
    projectPath: project.path,
    sessionId: selectedSessionId,
    previousSessionId: selectedSessionId,
    draftSessionId,
    source: 'desktop-ipc',
    status: 'running',
    label: sendMode === 'steer' ? '已发送到当前任务' : '已交给桌面端处理',
    startedAt: now
  });
  broadcast({
    type: 'user-message',
    sessionId: selectedSessionId,
    projectId: project.id,
    message: {
      id: `local-${Date.now()}`,
      role: 'user',
      content: visibleMessage,
      ...userMessageMetadataForSendMode(sendMode),
      timestamp: now
    }
  });
  broadcast({
    type: 'status-update',
    source: bridge?.mode || 'desktop-ipc',
    projectId: project.id,
    sessionId: selectedSessionId,
    turnId,
    kind: 'turn',
    status: 'running',
    label: sendMode === 'steer' ? '已发送到当前任务' : '已交给桌面端处理',
    detail: '',
    timestamp: new Date().toISOString()
  });
  return {
    accepted: true,
    queued: false,
    sessionId: selectedSessionId,
    draftSessionId,
    turnId: appTurnId,
    clientTurnId: turnId,
    delivery: sendMode === 'steer' ? 'steered' : (sendMode === 'interrupt' ? 'interrupted-started' : 'started'),
    desktopBridge: bridge
  };
}

export function runQueuedHeadlessChatJob({
  job,
  queueKey,
  state,
  sessionId,
  runCodexTurn,
  registerProjectlessThread,
  registerMobileSession,
  refreshCodexCache,
  broadcast,
  rememberConversationAlias,
  rememberTurn,
  rememberLiveSession,
  notifyDesktopThreadListChanged,
  emitJobEvent,
  scheduleAutoNameCompletedSession,
  onQueueDrained
}) {
  const metadataUpdates = [];
  let lastBackgroundThread = null;

  function rememberStartedBackgroundThread(payload) {
    if (!payload?.sessionId || !job.draftSessionId) {
      return;
    }
    const updatedAt = payload.startedAt || new Date().toISOString();
    const visibleContent = job.visibleMessage || job.displayMessage;
    const sessionRecord = {
      id: payload.sessionId,
      projectId: job.project.id,
      projectPath: job.executionProjectPath || job.project.path,
      projectless: Boolean(job.project?.projectless),
      title: job.displayMessage,
      summary: job.displayMessage,
      updatedAt,
      filePath: payload.filePath || payload.path || null,
      messages: [
        {
          id: `${payload.sessionId}-user-${job.turnId}`,
          role: 'user',
          content: visibleContent,
          timestamp: updatedAt
        }
      ]
    };
    const backgroundThread = {
      threadId: payload.sessionId,
      cwd: payload.cwd || job.executionProjectPath || job.project.path || null
    };
    lastBackgroundThread = backgroundThread;
    rememberLiveSession?.(sessionRecord);
    metadataUpdates.push(
      Promise.all([
        job.project?.projectless
          ? registerProjectlessThread(payload.sessionId, job.project.path)
          : Promise.resolve(null),
        registerMobileSession(sessionRecord)
      ]).then(() =>
        notifyDesktopThreadListChanged?.({
          ...backgroundThread,
          reason: 'background-thread-started'
        })
      ).catch((error) => {
        console.warn('[sessions] Failed to register background thread:', error.message);
      })
    );
  }

  runCodexTurn(
    {
      sessionId,
      draftSessionId: job.draftSessionId,
      projectPath: job.executionProjectPath || job.project.path,
      message: job.codexMessage,
      attachments: job.attachments,
      selectedSkills: job.selectedSkills,
      model: job.model,
      reasoningEffort: job.reasoningEffort,
      serviceTier: job.serviceTier,
      permissionMode: job.permissionMode,
      collaborationMode: job.collaborationMode,
      turnId: job.turnId
    },
    (payload) => {
      const eventPayload = {
        ...payload,
        source: payload?.source || 'headless-local'
      };
      if (eventPayload.sessionId) {
        state.sessionId = eventPayload.sessionId;
        rememberConversationAlias(queueKey, eventPayload.sessionId);
      }
      if (eventPayload.previousSessionId) {
        rememberConversationAlias(queueKey, eventPayload.previousSessionId);
      }
      if (eventPayload.type === 'thread-started') {
        rememberStartedBackgroundThread(eventPayload);
      } else if (eventPayload.type === 'chat-started') {
        rememberStartedBackgroundThread(eventPayload);
      }
      emitJobEvent(job, eventPayload);
    }
  ).then(async (finalSessionId) => {
    if (finalSessionId) {
      state.sessionId = finalSessionId;
      rememberConversationAlias(queueKey, finalSessionId);
    }
    rememberTurn(job.turnId, {
      projectId: job.project.id,
      sessionId: finalSessionId || sessionId || job.selectedSessionId || job.draftSessionId || null,
      previousSessionId: job.draftSessionId || job.selectedSessionId || null
    });
    if (job.draftSessionId) {
      scheduleAutoNameCompletedSession({
        sessionId: finalSessionId || sessionId || job.selectedSessionId || null,
        turnId: job.turnId,
        userMessage: job.displayMessage
      });
    }
  }).finally(async () => {
    try {
      if (metadataUpdates.length) {
        await Promise.allSettled(metadataUpdates);
      }
      const snapshot = await refreshCodexCache();
      broadcast({ type: 'sync-complete', syncedAt: snapshot.syncedAt, projects: snapshot.projects });
      if (lastBackgroundThread) {
        await notifyDesktopThreadListChanged?.({
          ...lastBackgroundThread,
          reason: 'background-thread-completed'
        });
      }
    } catch (error) {
      console.warn('[sync] Failed to refresh after chat:', error.message);
    } finally {
      state.running = false;
      if (state.jobs.length) {
        onQueueDrained?.();
      }
    }
  });
}
