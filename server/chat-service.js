/**
 * 组装聊天业务：后台 Codex 执行、队列、图片与自动标题等子能力。
 *
 * Keywords: chat-service, codex-turn, queue
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
import { registerMobileSession as registerMobileSessionInIndex } from './mobile-session-index.js';
import { createChatQueue } from './chat-queue.js';
import { runQueuedHeadlessChatJob } from './chat-delivery.js';
import {
  prepareChatRequest,
  projectlessThreadWorkingDirectory
} from './chat-request-prep.js';
import { buildCodexTurnInput } from './codex-native-images.js';
import { createChatImageHandler } from './chat-image-handler.js';
import { createChatAutoNamer } from './chat-auto-title.js';
import {
  compactActiveRuns,
  runtimeDebugLine
} from './runtime-debug.js';

export { normalizeSelectedSkills } from './chat-request-prep.js';

const IMPLEMENT_PLAN_MESSAGE_RE = /^(?:implement\s+plan\.?|执行计划)$/iu;

function planImplementationHeadlessMessage({ codexMessage, visibleMessage, collaborationMode, planImplementation }) {
  const codexText = String(codexMessage || '').trim();
  const visibleText = String(visibleMessage || '').trim();
  const isPlanImplementation = collaborationMode?.mode === 'default' &&
    (IMPLEMENT_PLAN_MESSAGE_RE.test(codexText) || IMPLEMENT_PLAN_MESSAGE_RE.test(visibleText));
  if (!isPlanImplementation) {
    return codexMessage;
  }
  const planContent = String(planImplementation?.planContent || '').trim();
  return planContent ? `PLEASE IMPLEMENT THIS PLAN:\n${planContent}` : codexMessage;
}

export function createChatService({
  imagePromptState,
  defaultReasoningEffort = 'xhigh',
  uploadRoot = '',
  getProject,
  getSession,
  getCacheSnapshot,
  listProjectSessions,
  refreshCodexCache,
  renameSession,
  broadcast,
  runCodexTurn,
  abortCodexTurn,
  getActiveRuns,
  runImageTurn,
  isImageRequest,
  useLegacyImageGenerator,
  maybeAutoNameSession,
  registerProjectlessThread = registerProjectlessThreadInCodexState,
  registerMobileSession = registerMobileSessionInIndex,
  rememberLiveSession = () => null
}) {
  const chatQueue = createChatQueue();
  const getConversationQueue = chatQueue.getConversationQueue;
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

  function enqueueChatJob(job, { forceQueued = false, autoStart = true } = {}) {
    const { queued, state } = chatQueue.enqueueJob(job, { forceQueued });

    if (queued) {
      const sessionId = state.sessionId || job.selectedSessionId || job.draftSessionId;
      rememberTurn(job.turnId, {
        source: 'headless-local',
        status: 'queued',
        label: '已加入队列',
        sessionId: sessionId || null
      });
      broadcast({
        type: 'status-update',
        projectId: job.project.id,
        sessionId,
        turnId: job.turnId,
        source: 'headless-local',
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
      defaultReasoningEffort,
      uploadRoot
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

    const imagePrompt = chatImage.resolveImagePrompt({
      enabled: useLegacyImageGenerator(),
      projectId: project.id,
      displayMessage,
      attachments
    });
    const queueKey = resolveConversationKey(selectedSessionId, draftSessionId, requestedSessionId);
    const existingConversationState = getConversationQueue(queueKey);
    if (!selectedSessionId && draftSessionId && existingConversationState.sessionId) {
      selectedSessionId = existingConversationState.sessionId;
      conversationSessionId = selectedSessionId;
    }
    const shouldHoldInLocalQueue =
      sendMode === 'queue' &&
      conversationSessionId &&
      sessionHasActiveWork(conversationSessionId);

    runtimeDebugLine('sendChat.enter', {
      remoteAddress,
      sendMode,
      imagePrompt: Boolean(imagePrompt),
      selectedSessionId,
      draftSessionId,
      conversationSessionId,
      turnId,
      queueKey,
      shouldHoldInLocalQueue,
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
        permissionMode: body.permissionMode || 'default',
        collaborationMode: collaborationMode || null
      }, { forceQueued: true, autoStart: false });
      runtimeDebugLine('sendChat.exit', { branch: 'hold-local-queue', delivery: 'queued', turnId });
      return {
        accepted: true,
        queued,
        sessionId: selectedSessionId,
        draftSessionId,
        turnId,
        delivery: 'queued'
      };
    }

    if (sendMode === 'steer') {
      const error = new Error('运行中任务暂不支持追加消息，请稍后重试。');
      error.statusCode = 409;
      error.code = 'STEER_NOT_SUPPORTED';
      throw error;
    }

    rememberTurn(turnId, {
      projectId: project.id,
      projectPath: project.path,
      sessionId: conversationSessionId,
      previousSessionId: draftSessionId || selectedSessionId || null,
      draftSessionId,
      source: 'headless-local',
      status: 'accepted',
      label: '正在思考',
      hadAssistantText: false,
      startedAt: new Date().toISOString()
    });

    broadcast({
      type: 'user-message',
      sessionId: conversationSessionId,
      projectId: project.id,
      turnId,
      clientTurnId: turnId,
      message: {
        id: `local-${Date.now()}`,
        role: 'user',
        content: visibleMessage,
        turnId,
        deliveryState: 'confirmed',
        timestamp: new Date().toISOString()
      }
    });
    const headlessCodexMessage = planImplementationHeadlessMessage({
      codexMessage,
      visibleMessage,
      collaborationMode,
      planImplementation: body.planImplementation
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
        config
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
      codexMessage: headlessCodexMessage,
      displayMessage,
      visibleMessage,
      attachments,
      selectedSkills,
      fileMentions,
      model: modelForTurn,
      reasoningEffort: reasoningEffortForTurn,
      serviceTier: serviceTierForTurn,
      permissionMode: body.permissionMode || 'default',
      collaborationMode: collaborationMode || null
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
      delivery
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

    const activeTurn = chatQueue.findActiveTurnForSession(sessionId, { source: 'headless-local' });
    if (activeTurn) {
      const abortIdentifier = activeTurn.turnId || turnId || sessionId;
      const aborted = abortCodexTurn(abortIdentifier);
      const completedAt = new Date().toISOString();
      const payload = {
        type: 'chat-aborted',
        source: 'headless-local',
        projectId: body.projectId || activeTurn.projectId || undefined,
        sessionId: sessionId || activeTurn.sessionId || undefined,
        previousSessionId: previousSessionId || activeTurn.previousSessionId || undefined,
        turnId: abortIdentifier,
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
      runtimeDebugLine('abortChat.exit', { branch: 'headless-recent-turn', aborted: Boolean(aborted || abortIdentifier) });
      return true;
    }

    const aborted = abortCodexTurn(turnId || sessionId);
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
    sessionHasActiveWork
  };
}
