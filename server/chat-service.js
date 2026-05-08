import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeFileMentions,
  normalizeAttachments,
  withFileMentionReferences,
  withAttachmentReferences,
  withImageAttachmentPreviews
} from './upload-service.js';
import {
  defaultProjectlessWorkspaceRoot,
  registerProjectlessThread as registerProjectlessThreadInCodexState
} from './codex-config.js';
import { registerMobileSession as registerMobileSessionInIndex } from './mobile-session-index.js';
import { createChatQueue } from './chat-queue.js';
import {
  assertDesktopBridgeAvailable,
  backgroundFallbackBridge,
  desktopIpcCanUseBackgroundFallback,
  runQueuedHeadlessChatJob,
  sendViaDesktopIpc
} from './chat-delivery.js';
import { createChatImageHandler } from './chat-image-handler.js';

function dateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function slugFromMessage(message, fallback = 'mobile-chat') {
  const ascii = String(message || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 48);
  return ascii || fallback;
}

async function projectlessThreadWorkingDirectory(project, message) {
  const root = path.resolve(project?.path || defaultProjectlessWorkspaceRoot());
  const day = dateStamp();
  const slug = slugFromMessage(message);
  const unique = `${slug}-${Date.now().toString(36)}`;
  const cwd = path.join(root, day, unique);
  await fs.mkdir(cwd, { recursive: true });
  return cwd;
}

export function normalizeSelectedSkills(value, availableSkills = []) {
  const requested = Array.isArray(value) ? value : [];
  if (!requested.length || !Array.isArray(availableSkills) || !availableSkills.length) {
    return [];
  }

  const byPath = new Map();
  const byName = new Map();
  for (const skill of availableSkills) {
    if (skill?.path) {
      byPath.set(String(skill.path), skill);
    }
    if (skill?.name) {
      byName.set(String(skill.name), skill);
    }
  }

  const selected = [];
  const seen = new Set();
  for (const item of requested) {
    const pathValue = typeof item === 'string' ? item : item?.path;
    const nameValue = typeof item === 'string' ? item : item?.name;
    const skill = byPath.get(String(pathValue || '')) || byName.get(String(nameValue || ''));
    if (!skill?.path || seen.has(skill.path)) {
      continue;
    }
    seen.add(skill.path);
    selected.push({
      type: 'skill',
      name: skill.name || skill.label || path.basename(path.dirname(skill.path)),
      path: skill.path
    });
  }
  return selected.slice(0, 8);
}

function normalizeCollaborationMode(value, { model = '', reasoningEffort = null } = {}) {
  const requestedMode = typeof value === 'string' ? value : value?.mode;
  if (String(requestedMode || '').trim().toLowerCase() !== 'plan') {
    return null;
  }
  const settings = typeof value === 'object' && value?.settings ? value.settings : {};
  return {
    mode: 'plan',
    settings: {
      model: String(settings.model ?? model ?? '').trim(),
      reasoning_effort: settings.reasoning_effort ?? settings.reasoningEffort ?? reasoningEffort ?? null,
      developer_instructions: settings.developer_instructions ?? null
    }
  };
}

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
  setDesktopFollowerCollaborationMode,
  abortCodexTurn,
  getActiveRuns,
  runImageTurn,
  isImageRequest,
  useLegacyImageGenerator,
  maybeAutoNameSession,
  registerProjectlessThread = registerProjectlessThreadInCodexState,
  registerMobileSession = registerMobileSessionInIndex
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
    return chatQueue.sessionHasActiveWork(sessionId, [...getActiveRuns(), ...chatImage.getActiveImageRuns()]);
  }

  function emitJobEvent(job, payload) {
    const enriched = { projectId: job.project.id, ...payload };
    rememberTurnEvent(enriched);
    broadcast(enriched);
  }

  async function autoNameCompletedSession({ sessionId, turnId, userMessage }) {
    if (!sessionId || !turnId) {
      return;
    }
    const turn = chatQueue.getTurn(turnId) || {};
    const assistantMessage = turn.assistantPreview || '';
    if (!String(userMessage || assistantMessage || '').trim()) {
      return;
    }

    await refreshCodexCache();
    const session = getSession(sessionId);
    if (!session || session.titleLocked) {
      return;
    }

    const renamed = await maybeAutoNameSession({
      session,
      userMessage,
      assistantMessage,
      renameSessionImpl: renameSession
    });
    if (renamed) {
      const snapshot = await refreshCodexCache();
      broadcast({ type: 'sync-complete', syncedAt: snapshot.syncedAt, projects: snapshot.projects });
    }
  }

  function scheduleAutoNameCompletedSession(payload) {
    autoNameCompletedSession(payload).catch((error) => {
      console.warn('[title] auto naming failed:', error.message);
    });
  }

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
    const attachments = normalizeAttachments(body.attachments);
    const fileMentions = normalizeFileMentions(body.fileMentions);
    const message = String(body.message || '').trim();
    if (!message && !attachments.length) {
      const error = new Error('message or attachments are required');
      error.statusCode = 400;
      throw error;
    }
    let bridge = await assertDesktopBridgeAvailable(getDesktopBridgeStatus);

    const requestedSessionId = String(body.sessionId || '').trim();
    const isDraftSession = requestedSessionId.startsWith('draft-');
    const session = requestedSessionId && !isDraftSession ? getSession(requestedSessionId) : null;
    const draftSessionId = String(body.draftSessionId || '').trim() || null;
    const selectedSessionId = session && !session.mobileOnly
      ? session.id
      : (requestedSessionId && !isDraftSession ? requestedSessionId : null);
    const turnId = String(body.clientTurnId || '').trim() || crypto.randomUUID();
    const sendMode = String(body.sendMode || body.mode || 'start').trim();
    const config = getCacheSnapshot().config || {};
    const selectedSkills = normalizeSelectedSkills(body.selectedSkills, config.skills);
    const modelForTurn = session?.model || body.model || config.model || 'gpt-5.5';
    const reasoningEffortForTurn = body.reasoningEffort || defaultReasoningEffort;
    const collaborationMode = normalizeCollaborationMode(body.collaborationMode, {
      model: modelForTurn,
      reasoningEffort: reasoningEffortForTurn
    });
    const displayMessage = message || '请查看附件。';
    const visibleMessage = withImageAttachmentPreviews(displayMessage, attachments);
    const codexMessage = withFileMentionReferences(
      withAttachmentReferences(displayMessage, attachments),
      fileMentions
    );
    const imagePrompt = chatImage.resolveImagePrompt({
      enabled: useLegacyImageGenerator(),
      projectId: project.id,
      displayMessage,
      attachments
    });
    const conversationSessionId = selectedSessionId || draftSessionId || null;
    const queueKey = resolveConversationKey(selectedSessionId, draftSessionId, requestedSessionId);
    const shouldHoldInLocalQueue =
      sendMode === 'queue' &&
      conversationSessionId &&
      sessionHasActiveWork(conversationSessionId);

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
        attachments,
        selectedSkills,
        fileMentions,
        model: modelForTurn,
        reasoningEffort: reasoningEffortForTurn,
        permissionMode: body.permissionMode || 'bypassPermissions',
        collaborationMode
      }, { forceQueued: true, autoStart: false });
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
      if (!selectedSessionId && desktopIpcCanUseBackgroundFallback(bridge)) {
        bridge = backgroundFallbackBridge(bridge, '桌面端还不能从手机新建真实桌面线程，已改用后台 Codex 新建。');
      } else {
        try {
          return await sendViaDesktopIpc({
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
            permissionMode: body.permissionMode || 'bypassPermissions',
            collaborationMode,
            getSession,
            rememberTurn,
            broadcast,
            setDesktopFollowerCollaborationMode,
            steerDesktopFollowerTurn,
            startDesktopFollowerTurn,
            interruptDesktopFollowerTurn
          });
        } catch (error) {
          if (error?.code !== 'CODEXMOBILE_DESKTOP_THREAD_OWNER_UNAVAILABLE' || !desktopIpcCanUseBackgroundFallback(bridge)) {
            throw error;
          }
          bridge = backgroundFallbackBridge(bridge);
        }
      }
    }

    if (sendMode === 'steer') {
      if (!selectedSessionId) {
        const error = new Error('新对话还没有桌面端线程，不能发送到当前任务。');
        error.statusCode = 409;
        throw error;
      }
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
      return chatImage.startImageChat({
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
    }

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
      attachments,
      selectedSkills,
      fileMentions,
      model: modelForTurn,
      reasoningEffort: reasoningEffortForTurn,
      permissionMode: body.permissionMode || 'bypassPermissions',
      collaborationMode
    });

    return {
      accepted: true,
      queued,
      sessionId: selectedSessionId,
      draftSessionId,
      turnId,
      delivery: sendMode === 'interrupt' ? 'interrupted-started' : (queued ? 'queued' : 'started'),
      desktopBridge: bridge
    };
  }

  function abortChat(body = {}, { remoteAddress = '' } = {}) {
    const turnId = String(body.turnId || '').trim();
    const sessionId = String(body.sessionId || '').trim();
    const previousSessionId = String(body.previousSessionId || '').trim();
    console.log(`[chat] abort request remote=${remoteAddress} turn=${turnId} session=${sessionId}`);
    const aborted = abortCodexTurn(turnId || sessionId);
    if (!turnId && !aborted) {
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
