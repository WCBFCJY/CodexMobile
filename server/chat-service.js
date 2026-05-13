/**
 * 组装聊天业务：队列、桌面桥接/后台 fallback、图片与自动标题等子能力。
 *
 * Keywords: chat-service, desktop-bridge, codex-turn, queue, attachments
 *
 * Exports:
 * - createChatService — 创建可注入依赖的聊天服务实例。
 * - normalizeSelectedSkills — 再导出自 chat-request-prep。
 *
 * Inward（本模块依赖/组装的关键符号）: chat-queue、chat-delivery、chat-request-prep、chat-image-handler、runtime-debug。
 *
 * Outward（谁在用/调用场景）: HTTP 聊天路由或上层服务装配。
 *
 * 不负责: Codex CLI 进程细节（由 codex-runner 等承担）。
 */
import {
  registerProjectlessThread as registerProjectlessThreadInCodexState
} from './codex-config.js';
import {
  notifyDesktopThreadListChanged as notifyDesktopThreadListChangedInCodexApp
} from './codex-app-server.js';
import { registerMobileSession as registerMobileSessionInIndex } from './mobile-session-index.js';
import { createChatQueue } from './chat-queue.js';
import {
  assertDesktopBridgeAvailable,
  backgroundFallbackBridge,
  desktopIpcCanUseBackgroundFallback,
  runQueuedHeadlessChatJob,
  sendViaDesktopIpc
} from './chat-delivery.js';
import {
  prepareChatRequest,
  projectlessThreadWorkingDirectory
} from './chat-request-prep.js';
import { createChatImageHandler } from './chat-image-handler.js';
import { createChatAutoNamer } from './chat-auto-title.js';
import {
  compactActiveRuns,
  runtimeDebugLine
} from './runtime-debug.js';

export { normalizeSelectedSkills } from './chat-request-prep.js';

export function createChatService({
  imagePromptState,
  defaultReasoningEffort = 'xhigh',
  getProject,
  getSession,
  getCacheSnapshot,
  getDesktopBridgeStatus,
  listProjectSessions,
  refreshCodexCache,
  renameSession,
  broadcast,
  runCodexTurn,
  steerCodexTurn,
  startDesktopFollowerTurn,
  steerDesktopFollowerTurn,
  interruptDesktopFollowerTurn,
  setDesktopFollowerModelAndReasoning,
  setDesktopFollowerCollaborationMode,
  abortCodexTurn,
  getActiveRuns,
  runImageTurn,
  isImageRequest,
  useLegacyImageGenerator,
  maybeAutoNameSession,
  registerProjectlessThread = registerProjectlessThreadInCodexState,
  registerMobileSession = registerMobileSessionInIndex,
  rememberLiveSession = () => null,
  notifyDesktopThreadListChanged = notifyDesktopThreadListChangedInCodexApp,
  desktopOwnerRetryDelays = [250, 700, 1500],
  desktopIpcTimeoutMs = Math.max(1500, Number(process.env.CODEXMOBILE_DESKTOP_IPC_SEND_TIMEOUT_MS) || 6000)
}) {
  const chatQueue = createChatQueue();
  const getConversationQueue = chatQueue.getConversationQueue;
  const findActiveTurnForSession = chatQueue.findActiveTurnForSession;
  const rememberConversationAlias = chatQueue.rememberConversationAlias;
  const rememberTurn = chatQueue.rememberTurn;
  const rememberTurnEvent = chatQueue.rememberTurnEvent;
  const resolveConversationKey = chatQueue.resolveConversationKey;
  const chatImage = createChatImageHandler({
    imagePromptState,
    runImageTurn,
    isImageRequest,
    listProjectSessions,
    refreshCodexCache,
    broadcast,
    rememberTurn,
    emitJobEvent: (job, payload) => emitJobEvent(job, payload)
  });
  function sessionHasActiveWork(sessionId) {
    return chatQueue.sessionHasActiveWork(sessionId, [
      ...getActiveRuns(),
      ...chatImage.getActiveImageRuns()
    ]);
  }

  function activeLocalRunForAbort({ turnId = '', sessionId = '', previousSessionId = '' } = {}) {
    const ids = new Set([turnId, sessionId, previousSessionId].map((value) => String(value || '').trim()).filter(Boolean));
    if (!ids.size) {
      return null;
    }
    return getActiveRuns().find((run) => (
      run?.status === 'running' &&
      [run.turnId, run.sessionId, run.previousSessionId].some((value) => ids.has(String(value || '').trim()))
    )) || null;
  }

  function emitJobEvent(job, payload) {
    const enriched = { projectId: job.project.id, ...payload };
    rememberTurnEvent(enriched);
    broadcast(enriched);
  }

  const { scheduleAutoNameCompletedSession } = createChatAutoNamer({
    getTurn: chatQueue.getTurn,
    refreshCodexCache,
    getSession,
    maybeAutoNameSession,
    renameSession,
    broadcast
  });

  async function steerQueuedDraft(query = {}) {
    const draft = chatQueue.removeQueuedDraft(query);
    if (!draft) {
      return null;
    }
    const sessionId = String(query.sessionId || draft.sessionId || '').trim();
    if (!sessionId) {
      const error = new Error('没有可发送到当前任务的线程。');
      error.statusCode = 409;
      throw error;
    }
    return sendChat({
      projectId: query.projectId || draft.projectId,
      sessionId,
      message: draft.text,
      attachments: draft.attachments,
      selectedSkills: draft.selectedSkills,
      fileMentions: draft.fileMentions,
      collaborationMode: draft.collaborationMode,
      sendMode: 'steer'
    });
  }

  function enqueueChatJob(job, { forceQueued = false, autoStart = true } = {}) {
    const { queued, state } = chatQueue.enqueueJob(job, { forceQueued });

    if (queued) {
      const sessionId = state.sessionId || job.selectedSessionId || job.draftSessionId;
      rememberTurn(job.turnId, {
        status: 'queued',
        label: '已加入队列',
        sessionId: sessionId || null
      });
      broadcast({
        type: 'status-update',
        projectId: job.project.id,
        sessionId,
        turnId: job.turnId,
        kind: 'turn',
        status: 'queued',
        label: '已加入队列',
        detail: '',
        timestamp: new Date().toISOString()
      });
    }

    if (autoStart) {
      runNextQueuedChat(job.queueKey);
    }
    return queued;
  }

  function runNextQueuedChat(queueKey) {
    const state = getConversationQueue(queueKey);
    if (state.running) {
      return;
    }

    const job = state.jobs.shift();
    if (!job) {
      return;
    }

    state.running = true;
    const sessionId = state.sessionId || job.selectedSessionId;

    runQueuedHeadlessChatJob({
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
      onQueueDrained: () => setTimeout(() => runNextQueuedChat(queueKey), 0)
    });
  }

  async function sendChat(body, { remoteAddress = '' } = {}) {
    const attachmentCount = Array.isArray(body.attachments) ? body.attachments.length : 0;
    console.log(
      `[chat] send request remote=${remoteAddress} project=${body.projectId || ''} session=${body.sessionId || body.draftSessionId || ''} attachments=${attachmentCount}`
    );
    const project = getProject(body.projectId);
    if (!project) {
      console.warn(`[chat] rejected project not found: ${body.projectId || ''}`);
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }
    const config = getCacheSnapshot().config || {};
    const prepared = prepareChatRequest(body, {
      getSession,
      config,
      defaultReasoningEffort
    });
    const {
      attachments,
      fileMentions,
      requestedSessionId,
      draftSessionId,
      turnId,
      sendMode,
      selectedSkills,
      modelForTurn,
      reasoningEffortForTurn,
      serviceTierForTurn,
      collaborationMode,
      displayMessage,
      visibleMessage,
      codexMessage
    } = prepared;
    let selectedSessionId = prepared.selectedSessionId;
    let conversationSessionId = prepared.conversationSessionId;
    let bridge = await assertDesktopBridgeAvailable(getDesktopBridgeStatus);

    const imagePrompt = chatImage.resolveImagePrompt({
      enabled: useLegacyImageGenerator(),
      projectId: project.id,
      displayMessage,
      attachments
    });
    const queueKey = resolveConversationKey(selectedSessionId, draftSessionId, requestedSessionId);
    const existingConversationState = getConversationQueue(queueKey);
    let selectedSessionResolvedFromBackgroundAlias = false;
    if (!selectedSessionId && draftSessionId && existingConversationState.sessionId) {
      selectedSessionId = existingConversationState.sessionId;
      conversationSessionId = selectedSessionId;
      selectedSessionResolvedFromBackgroundAlias = true;
    }
    const shouldHoldInLocalQueue =
      sendMode === 'queue' &&
      conversationSessionId &&
      sessionHasActiveWork(conversationSessionId);

    runtimeDebugLine('sendChat.enter', {
      remoteAddress,
      sendMode,
      imagePrompt: Boolean(imagePrompt),
      bridgeMode: bridge?.mode,
      bridgeConnected: bridge?.connected,
      selectedSessionId,
      draftSessionId,
      conversationSessionId,
      turnId,
      queueKey,
      shouldHoldInLocalQueue,
      selectedSessionResolvedFromBackgroundAlias,
      headlessRuns: compactActiveRuns(getActiveRuns()),
      imageRuns: compactActiveRuns(chatImage.getActiveImageRuns())
    });

    if (shouldHoldInLocalQueue) {
      const queued = enqueueChatJob({
        queueKey,
        project,
        selectedSessionId,
        draftSessionId,
        executionProjectPath: project.path,
        turnId,
        codexMessage,
        displayMessage,
        visibleMessage,
        attachments,
        selectedSkills,
        fileMentions,
        model: modelForTurn,
        reasoningEffort: reasoningEffortForTurn,
        serviceTier: serviceTierForTurn,
        permissionMode: body.permissionMode || 'bypassPermissions',
        collaborationMode
      }, { forceQueued: true, autoStart: false });
      runtimeDebugLine('sendChat.exit', { branch: 'hold-local-queue', delivery: 'queued', turnId });
      return {
        accepted: true,
        queued,
        sessionId: selectedSessionId,
        draftSessionId,
        turnId,
        delivery: 'queued',
        desktopBridge: bridge
      };
    }

    if (bridge?.mode === 'desktop-ipc' && !imagePrompt) {
      runtimeDebugLine('sendChat.branch', { branch: 'try-desktop-ipc', bridgeMode: bridge?.mode });
      if (!selectedSessionId && desktopIpcCanUseBackgroundFallback(bridge)) {
        bridge = backgroundFallbackBridge(bridge, '桌面端还不能从手机新建真实桌面线程，已改用后台 Codex 新建。');
        runtimeDebugLine('sendChat.bridge', {
          reason: 'no-session-background-fallback',
          bridgeModeAfter: bridge?.mode
        });
      } else {
        try {
          const result = await sendViaDesktopIpc({
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
            model: modelForTurn,
            reasoningEffort: reasoningEffortForTurn,
            serviceTier: serviceTierForTurn,
            permissionMode: body.permissionMode || 'bypassPermissions',
            collaborationMode,
            getSession,
            rememberTurn,
            broadcast,
            setDesktopFollowerModelAndReasoning,
            setDesktopFollowerCollaborationMode,
            steerDesktopFollowerTurn,
            startDesktopFollowerTurn,
            interruptDesktopFollowerTurn,
            desktopOwnerRetryDelays,
            desktopIpcTimeoutMs
          });
          runtimeDebugLine('sendChat.exit', {
            branch: 'desktop-ipc',
            delivery: result?.delivery || 'desktop-ipc',
            sessionId: result.sessionId,
            turnId: result.turnId || turnId
          });
          return result;
        } catch (error) {
          const canFallBackToBackground =
            error?.code === 'CODEXMOBILE_DESKTOP_THREAD_OWNER_UNAVAILABLE' &&
            desktopIpcCanUseBackgroundFallback(bridge);
          if (!canFallBackToBackground) {
            runtimeDebugLine('sendChat.exit', {
              branch: 'desktop-ipc',
              delivery: 'failed',
              sessionId: selectedSessionId,
              turnId,
              code: error?.code || null,
              error: error?.message || 'desktop ipc failed'
            });
            throw error;
          }
          bridge = backgroundFallbackBridge(
            bridge,
            selectedSessionResolvedFromBackgroundAlias
              ? undefined
              : '桌面端当前没有接管这个线程，已改用后台 Codex 继续执行。'
          );
          runtimeDebugLine('sendChat.bridge', {
            reason: 'desktop-ipc-error-fallback',
            code: error?.code || null,
            bridgeModeAfter: bridge?.mode
          });
        }
      }
    }

    if (sendMode === 'steer') {
      if (!selectedSessionId) {
        const error = new Error('新对话还没有桌面端线程，不能发送到当前任务。');
        error.statusCode = 409;
        throw error;
      }
      runtimeDebugLine('sendChat.branch', {
        branch: 'steer-headless',
        bridgeMode: bridge?.mode,
        selectedSessionId
      });
      const result = await steerCodexTurn(selectedSessionId, {
        message: codexMessage,
        attachments,
        selectedSkills
      });
      rememberTurn(turnId, {
        projectId: project.id,
        projectPath: project.path,
        sessionId: result.sessionId || selectedSessionId,
        previousSessionId: selectedSessionId,
        status: 'running',
        label: '已发送到当前任务'
      });
      broadcast({
        type: 'user-message',
        sessionId: result.sessionId || selectedSessionId,
        projectId: project.id,
        message: {
          id: `local-${Date.now()}`,
          role: 'user',
          content: visibleMessage,
          timestamp: new Date().toISOString()
        }
      });
      broadcast({
        type: 'status-update',
        projectId: project.id,
        sessionId: result.sessionId || selectedSessionId,
        turnId,
        kind: 'turn',
        status: 'running',
        label: '已发送到当前任务',
        detail: '',
        timestamp: new Date().toISOString()
      });
      runtimeDebugLine('sendChat.exit', {
        branch: 'steer',
        delivery: 'steered',
        sessionId: result.sessionId || selectedSessionId,
        turnId: result.turnId || turnId
      });
      return {
        accepted: true,
        queued: false,
        delivery: 'steered',
        sessionId: result.sessionId || selectedSessionId,
        draftSessionId,
        turnId: result.turnId || turnId,
        clientTurnId: turnId,
        desktopBridge: bridge
      };
    }

    rememberTurn(turnId, {
      projectId: project.id,
      projectPath: project.path,
      sessionId: conversationSessionId,
      previousSessionId: draftSessionId || selectedSessionId || null,
      draftSessionId,
      status: 'accepted',
      label: '正在思考',
      hadAssistantText: false,
      startedAt: new Date().toISOString()
    });

    broadcast({
      type: 'user-message',
      sessionId: conversationSessionId,
      projectId: project.id,
      message: {
        id: `local-${Date.now()}`,
        role: 'user',
        content: visibleMessage,
        timestamp: new Date().toISOString()
      }
    });

    if (imagePrompt) {
      runtimeDebugLine('sendChat.branch', { branch: 'image-chat' });
      const imageResult = await chatImage.startImageChat({
        project,
        selectedSessionId,
        conversationSessionId,
        draftSessionId,
        turnId,
        imagePrompt,
        attachments,
        config,
        bridge
      });
      runtimeDebugLine('sendChat.exit', {
        branch: 'image-chat',
        delivery: imageResult?.delivery || 'image',
        sessionId: imageResult?.sessionId ?? selectedSessionId ?? conversationSessionId,
        turnId: imageResult?.turnId ?? turnId
      });
      return imageResult;
    }

    runtimeDebugLine('sendChat.branch', {
      branch: 'headless',
      bridgeMode: bridge?.mode,
      sendMode,
      interrupt: sendMode === 'interrupt'
    });
    console.log(`[chat] accepted codex turn=${turnId} session=${selectedSessionId || draftSessionId || ''} project=${project.name}`);
    if (sendMode === 'interrupt' && selectedSessionId) {
      abortCodexTurn(selectedSessionId);
    }
    const executionProjectPath = project.projectless && draftSessionId && !selectedSessionId
      ? await projectlessThreadWorkingDirectory(project, displayMessage)
      : project.path;
    const queued = enqueueChatJob({
      queueKey,
      project,
      selectedSessionId,
      draftSessionId,
      executionProjectPath,
      turnId,
      codexMessage,
      displayMessage,
      visibleMessage,
      attachments,
      selectedSkills,
      fileMentions,
      model: modelForTurn,
      reasoningEffort: reasoningEffortForTurn,
      serviceTier: serviceTierForTurn,
      permissionMode: body.permissionMode || 'bypassPermissions',
      collaborationMode
    });

    const delivery =
      sendMode === 'interrupt' ? 'interrupted-started' : (queued ? 'queued' : 'started');
    runtimeDebugLine('sendChat.exit', {
      branch: 'headless',
      delivery,
      sessionId: selectedSessionId || draftSessionId || conversationSessionId,
      turnId,
      queued
    });
    return {
      accepted: true,
      queued,
      sessionId: selectedSessionId,
      draftSessionId,
      turnId,
      delivery,
      desktopBridge: bridge
    };
  }

  async function abortChat(body = {}, { remoteAddress = '' } = {}) {
    const turnId = String(body.turnId || '').trim();
    const sessionId = String(body.sessionId || '').trim();
    const previousSessionId = String(body.previousSessionId || '').trim();
    console.log(`[chat] abort request remote=${remoteAddress} turn=${turnId} session=${sessionId}`);
    runtimeDebugLine('abortChat.enter', {
      remoteAddress,
      turnId,
      sessionId,
      previousSessionId,
      headlessRuns: compactActiveRuns(getActiveRuns())
    });
    const localRun = activeLocalRunForAbort({ turnId, sessionId, previousSessionId });
    if (localRun) {
      const aborted = abortCodexTurn(localRun.turnId || turnId || sessionId);
      const completedAt = new Date().toISOString();
      const payload = {
        type: 'chat-aborted',
        source: 'headless-local',
        projectId: body.projectId || undefined,
        sessionId: sessionId || localRun.sessionId || undefined,
        previousSessionId: previousSessionId || localRun.previousSessionId || undefined,
        turnId: turnId || localRun.turnId || sessionId,
        completedAt,
        timestamp: completedAt
      };
      rememberTurn(payload.turnId, {
        projectId: payload.projectId,
        sessionId: payload.sessionId,
        previousSessionId: payload.previousSessionId,
        source: 'headless-local',
        status: 'aborted',
        label: '已中止',
        completedAt
      });
      broadcast(payload);
      runtimeDebugLine('abortChat.exit', { branch: 'headless-local', aborted: Boolean(aborted || turnId || sessionId) });
      return Boolean(aborted || turnId || sessionId);
    }
    const aborted = abortCodexTurn(turnId || sessionId);
    if (!aborted && sessionId && interruptDesktopFollowerTurn) {
      const bridge = await getDesktopBridgeStatus().catch(() => null);
      if (bridge?.connected && bridge.mode === 'desktop-ipc') {
        try {
          await interruptDesktopFollowerTurn(sessionId);
        } catch (error) {
          const wrapped = new Error(`桌面端中止失败：${error.message || '请在电脑端手动停止。'}`);
          wrapped.statusCode = error.statusCode || 502;
          throw wrapped;
        }
        const completedAt = new Date().toISOString();
        const activeDesktopTurn = findActiveTurnForSession(sessionId, { source: 'desktop-ipc' });
        const resolvedTurnId = activeDesktopTurn?.turnId || turnId || sessionId;
        const payload = {
          type: 'chat-aborted',
          source: 'desktop-ipc',
          projectId: body.projectId || undefined,
          sessionId,
          previousSessionId: previousSessionId || undefined,
          turnId: resolvedTurnId,
          completedAt,
          timestamp: completedAt
        };
        rememberTurn(payload.turnId, {
          projectId: payload.projectId,
          sessionId: payload.sessionId,
          previousSessionId: payload.previousSessionId,
          source: 'desktop-ipc',
          status: 'aborted',
          label: '已中止',
          completedAt
        });
        broadcast(payload);
        runtimeDebugLine('abortChat.exit', { branch: 'desktop-ipc-fallback', aborted: true });
        return true;
      }
    }
    if (!turnId && !aborted) {
      runtimeDebugLine('abortChat.exit', { branch: 'noop', aborted: false });
      return false;
    }

    const completedAt = new Date().toISOString();
    const payload = {
      type: 'chat-aborted',
      projectId: body.projectId || undefined,
      sessionId: sessionId || undefined,
      previousSessionId: previousSessionId || undefined,
      turnId: turnId || sessionId,
      completedAt,
      timestamp: completedAt
    };
    rememberTurn(payload.turnId, {
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      previousSessionId: payload.previousSessionId,
      status: 'aborted',
      label: '已中止',
      completedAt
    });
    broadcast(payload);
    runtimeDebugLine('abortChat.exit', { branch: 'generic-broadcast', aborted: true });
    return true;
  }

  return {
    abortChat,
    getActiveImageRuns: chatImage.getActiveImageRuns,
    getTurn(turnId) {
      return chatQueue.getTurn(turnId);
    },
    loadRecentImagePrompts: chatImage.loadRecentImagePrompts,
    listQueue: chatQueue.listQueue,
    removeQueuedDraft: chatQueue.removeQueuedDraft,
    restoreQueuedDraft: chatQueue.restoreQueuedDraft,
    sendChat,
    sessionHasActiveWork,
    steerQueuedDraft
  };
}
