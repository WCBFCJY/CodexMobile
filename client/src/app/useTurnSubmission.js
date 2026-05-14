/**
 * 封装用户回合提交：校验选择、拼装请求、乐观用户消息、错误与中断处理。
 *
 * Keywords: turn-submission, optimistic-user-message, composer-send
 *
 * Exports:
 * - `useTurnSubmission` — 绑定发送/队列所需状态与回调的 React hook。
 *
 * Inward: `api`；会话与活动合并逻辑（`session-utils`、`turn-submission-utils`、`activity-model`、`context-status`）。
 *
 * Outward: `App.jsx` 根组件注入 Composer 与聊天侧发送行为。
 */

import { apiFetch } from '../api.js';
import { contentWithAttachmentPreviews } from '../chat/MarkdownContent.jsx';
import { serviceTierForModelSpeed } from '../composer/composer-options.js';
import {
  dismissPlanImplementationPrompts,
  removeStalePlanRequestsAfterUserMessages
} from '../chat/activity-model.js';
import {
  autoTitlePatch,
  createClientTurnId,
  createDraftSession,
  isDraftSession,
  titleFromFirstMessage
} from './session-utils.js';
import {
  displayMessageForTurn,
  completeLocalAbortMessages,
  implementationPromptForPlan,
  prepareComposerSubmission,
  projectForTurnSelection,
  restoredComposerText,
  sessionForTurnSelection,
  selectedSkillsForPaths,
  userMessageMetadataForSendMode
} from './turn-submission-utils.js';

export function useTurnSubmission({
  defaultReasoningEffort,
  selectedProject,
  selectedProjectRef,
  selectedSession,
  selectedSessionRef,
  projects,
  selectedSkillPaths,
  status,
  permissionMode,
  selectedModel,
  selectedModelSpeed,
  selectedReasoningEffort,
  input,
  attachments,
  fileMentions,
  runningById,
  runningByIdRef,
  setInput,
  setAttachments,
  setFileMentions,
  setSelectedSession,
  setExpandedProjectIds,
  setSessionsByProject,
  setMessages,
  upsertSessionInProject,
  markRun,
  clearRun,
  loadQueueDrafts
}) {
  function restoreTextToInput(text) {
    setInput((current) => restoredComposerText(current, text));
  }

  async function submitCodexMessage({
    message,
    attachmentsForTurn = [],
    fileMentionsForTurn = [],
    clearComposer = false,
    restoreTextOnError = false,
    sendMode = 'start',
    collaborationMode = null,
    visibleMessageOverride = null,
    codexMessageOverride = null,
    planImplementation = null
  }) {
    const project = projectForTurnSelection(selectedProject, selectedProjectRef, selectedSession, selectedSessionRef, projects);
    const selectedAttachments = Array.isArray(attachmentsForTurn) ? attachmentsForTurn : [];
    const selectedFileMentions = Array.isArray(fileMentionsForTurn) ? fileMentionsForTurn : [];
    const displayMessage = displayMessageForTurn(visibleMessageOverride ?? message, selectedAttachments, selectedFileMentions);
    const requestMessage = String(codexMessageOverride || displayMessage || '').trim();
    if ((!displayMessage && !selectedAttachments.length && !selectedFileMentions.length) || !project) {
      if (restoreTextOnError && displayMessage) {
        restoreTextToInput(displayMessage);
      }
      throw new Error(project ? 'message or attachments are required' : '请先选择项目');
    }

    let sessionForTurn = sessionForTurnSelection(selectedSession, selectedSessionRef);
    if (!sessionForTurn) {
      sessionForTurn = createDraftSession(project);
      selectedSessionRef.current = sessionForTurn;
      setSelectedSession(sessionForTurn);
      setExpandedProjectIds((current) => ({ ...current, [project.id]: true }));
      setSessionsByProject((current) => upsertSessionInProject(current, project.id, sessionForTurn));
    }

    const turnId = createClientTurnId();
    const draftSessionId = isDraftSession(sessionForTurn) ? sessionForTurn.id : null;
    const outgoingSessionId = draftSessionId ? null : sessionForTurn?.id || null;
    const optimisticSessionId = draftSessionId || outgoingSessionId || turnId;
    const initialTitle = draftSessionId && !sessionForTurn.titleLocked
      ? titleFromFirstMessage(displayMessage)
      : null;
    const optimisticContent = contentWithAttachmentPreviews(displayMessage, selectedAttachments);

    if (clearComposer) {
      setInput('');
      setAttachments([]);
      setFileMentions([]);
    }

    const optimisticSessionPatch = { turnId, ...autoTitlePatch(initialTitle) };
    selectedSessionRef.current = { ...sessionForTurn, ...optimisticSessionPatch };
    setSelectedSession((current) =>
      current?.id === sessionForTurn?.id
        ? { ...current, ...optimisticSessionPatch }
        : current
    );
    setSessionsByProject((current) => ({
      ...current,
      [project.id]: (current[project.id] || []).map((item) =>
        item.id === sessionForTurn.id
          ? { ...item, ...optimisticSessionPatch }
          : item
      )
    }));
    const submittedAt = new Date().toISOString();
    const localUserMessageId = `local-${Date.now()}`;
    const localUserMessage = {
      id: localUserMessageId,
      role: 'user',
      content: optimisticContent,
      ...userMessageMetadataForSendMode(sendMode),
      timestamp: submittedAt,
      sessionId: optimisticSessionId,
      turnId,
      deliveryState: 'pending'
    };
    setMessages((current) =>
      removeStalePlanRequestsAfterUserMessages([...current, localUserMessage])
    );
    markRun?.({
      source: 'local-optimistic',
      projectId: project.id,
      sessionId: optimisticSessionId,
      previousSessionId: draftSessionId || outgoingSessionId,
      draftSessionId,
      turnId,
      status: 'queued',
      label: '消息发送中',
      startedAt: submittedAt,
      timestamp: submittedAt,
      steerable: false
    });

    try {
      const result = await apiFetch('/api/chat/send', {
        method: 'POST',
        body: {
          projectId: project.id,
          sessionId: outgoingSessionId,
          draftSessionId,
          clientTurnId: turnId,
          message: requestMessage,
          visibleMessage: displayMessage,
          permissionMode,
          model: selectedModel || status.model,
          serviceTier: serviceTierForModelSpeed(selectedModelSpeed),
          reasoningEffort: selectedReasoningEffort || status.reasoningEffort || defaultReasoningEffort,
          selectedSkills: selectedSkillsForPaths(status.skills, selectedSkillPaths),
          attachments: selectedAttachments,
          fileMentions: selectedFileMentions,
          sendMode,
          collaborationMode,
          ...(planImplementation ? { planImplementation } : {})
        }
      });
      const resultTurnId = result.turnId || turnId;
      const acceptedAt = new Date().toISOString();
      markRun?.({
        source: 'headless-local',
        projectId: project.id,
        sessionId: result.sessionId || optimisticSessionId,
        previousSessionId: draftSessionId || outgoingSessionId,
        draftSessionId,
        turnId: resultTurnId,
        clientTurnId: turnId,
        status: 'running',
        label: '执行中',
        startedAt: acceptedAt,
        timestamp: acceptedAt,
        steerable: true
      });
      setMessages((current) =>
        current.map((item) =>
          item.id === localUserMessageId
            ? {
              ...item,
              deliveryState: 'confirmed',
              turnId: resultTurnId,
              sessionId: result.sessionId || optimisticSessionId
            }
            : item
        )
      );
      return {
        turnId: resultTurnId,
        optimisticSessionId,
        projectId: project.id,
        previousSessionId: draftSessionId || outgoingSessionId
      };
    } catch (error) {
      clearRun({ turnId, sessionId: optimisticSessionId, previousSessionId: draftSessionId || outgoingSessionId });
      if (clearComposer) {
        setAttachments(selectedAttachments);
        setFileMentions(selectedFileMentions);
        if (String(message || '').trim()) {
          setInput(String(message).trim());
        }
      }
      if (restoreTextOnError) {
        restoreTextToInput(displayMessage);
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === localUserMessageId
            ? { ...item, deliveryState: 'failed', error: error.message }
            : item
        )
      );
      throw error;
    }
  }

  async function abortCurrentRun() {
    const currentSession = selectedSessionRef.current;
    const abortId =
      currentSession?.turnId ||
      currentSession?.id ||
      Object.keys(runningByIdRef.current || runningById)[0];
    if (!abortId) {
      return false;
    }
    const completedAt = new Date().toISOString();
    const abortPayload = {
      sessionId: currentSession?.id || abortId,
      turnId: currentSession?.turnId || null,
      previousSessionId: currentSession?.previousSessionId || null,
      completedAt,
      timestamp: completedAt
    };
    try {
      await apiFetch('/api/chat/abort', {
        method: 'POST',
        body: { sessionId: currentSession?.id || abortId, turnId: currentSession?.turnId || null }
      });
    } catch (error) {
      setMessages((current) =>
        upsertStatusMessage(current, {
          ...abortPayload,
          kind: 'turn',
          status: 'failed',
          label: '中止失败',
          detail: error.message || '桌面端没有确认中止，请在电脑端查看。',
          timestamp: new Date().toISOString()
        })
      );
      return false;
    }
    clearRun(abortPayload);
    setMessages((current) => completeLocalAbortMessages(current, abortPayload));
    return true;
  }

  async function handleSubmit({ mode = 'start', collaborationMode = null } = {}) {
    const prepared = prepareComposerSubmission(input, attachments, fileMentions, collaborationMode);
    const project = projectForTurnSelection(selectedProject, selectedProjectRef, selectedSession, selectedSessionRef, projects);
    if ((!prepared.message && !attachments.length && !fileMentions.length) || !project) {
      return false;
    }
    try {
      await submitCodexMessage({
        message: prepared.message,
        attachmentsForTurn: attachments,
        fileMentionsForTurn: fileMentions,
        clearComposer: true,
        sendMode: mode === 'guide' ? 'interrupt' : mode,
        collaborationMode: prepared.collaborationMode
      });
      await loadQueueDrafts(selectedSessionRef.current);
      return true;
    } catch {
      // submitCodexMessage already reflects the failure in the chat UI.
      return false;
    }
  }

  async function handleAbort() {
    await abortCurrentRun();
  }

  async function handleImplementPlan(planImplementation) {
    const planContent = String(planImplementation?.planContent || '').trim();
    const prompt = implementationPromptForPlan(planContent);
    if (!prompt) {
      return false;
    }
    try {
      await submitCodexMessage({
        message: '执行计划',
        visibleMessageOverride: '执行计划',
        codexMessageOverride: prompt,
        clearComposer: false,
        sendMode: 'start',
        collaborationMode: 'default',
        planImplementation
      });
      const requestId = String(planImplementation?.requestId || '').trim();
      const requestTurnId = String(planImplementation?.turnId || '').trim();
      setMessages((current) =>
        dismissPlanImplementationPrompts(current, {
          ...planImplementation,
          requestId,
          turnId: requestTurnId
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async function handleAdjustPlan(message, planImplementation = null) {
    const text = String(message || '').trim();
    if (!text) {
      return false;
    }
    try {
      await submitCodexMessage({
        message: text,
        clearComposer: false,
        sendMode: 'start',
        collaborationMode: null
      });
      if (planImplementation) {
        setMessages((current) => dismissPlanImplementationPrompts(current, planImplementation));
      }
      return true;
    } catch {
      return false;
    }
  }

  return {
    submitCodexMessage,
    handleSubmit,
    handleImplementPlan,
    handleAdjustPlan,
    handleAbort,
    abortCurrentRun
  };
}
