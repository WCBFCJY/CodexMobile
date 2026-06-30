/**
 * 聊天投递层：执行后台 headless Codex 队列。
 *
 * Keywords: headless-codex, codex-turn-input
 *
 * Exports:
 * - runQueuedHeadlessChatJob — 排队执行后台 Codex。
 *
 * Inward（本模块依赖/组装的关键符号）: codex-runner 风格的 runCodexTurn、session registration hooks。
 *
 * Outward（谁在用/调用场景）: chat-service。
 *
 * 不负责: HTTP 层与路由注册。
 */

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
  emitJobEvent,
  scheduleAutoNameCompletedSession,
  onQueueDrained
}) {
  const metadataUpdates = [];
  let lastBackgroundThread = null;
  let terminalEventSeen = false;

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
      ]).catch((error) => {
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
      collaborationMode: job.collaborationMode || null,
      turnId: job.turnId
    },
    (payload) => {
      const eventPayload = {
        ...payload,
        source: payload?.source || 'headless-local'
      };
      if (['chat-complete', 'chat-error', 'chat-aborted'].includes(eventPayload.type)) {
        terminalEventSeen = true;
      }
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
    if (!terminalEventSeen) {
      const completedAt = new Date().toISOString();
      terminalEventSeen = true;
      emitJobEvent(job, {
        type: 'chat-complete',
        source: 'headless-local',
        projectId: job.project.id,
        sessionId: finalSessionId || sessionId || job.selectedSessionId || null,
        previousSessionId: job.draftSessionId || job.selectedSessionId || null,
        turnId: job.turnId,
        completedAt,
        timestamp: completedAt
      });
    }
  }).catch((error) => {
    if (terminalEventSeen) {
      return;
    }
    const completedAt = new Date().toISOString();
    terminalEventSeen = true;
    emitJobEvent(job, {
      type: 'chat-error',
      source: 'headless-local',
      projectId: job.project.id,
      sessionId: state.sessionId || sessionId || job.selectedSessionId || null,
      previousSessionId: job.draftSessionId || job.selectedSessionId || null,
      turnId: job.turnId,
      error: error?.message || '任务失败',
      completedAt,
      timestamp: completedAt
    });
  }).finally(async () => {
    state.running = false;
    if (state.jobs.length) {
      onQueueDrained?.();
    }
    try {
      if (metadataUpdates.length) {
        await Promise.allSettled(metadataUpdates);
      }
      const snapshot = await refreshCodexCache();
      broadcast({ type: 'sync-complete', syncedAt: snapshot.syncedAt, projects: snapshot.projects });
    } catch (error) {
      console.warn('[sync] Failed to refresh after chat:', error.message);
    }
  });
}
