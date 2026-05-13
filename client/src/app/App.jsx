/**
 * CodexMobile Web：根级应用编排——认证门禁、服务端状态与 WS、会话域数据流、把 props 下发给 Shell。
 *
 * Keywords: pairing, websocket, bootstrap, session-orchestration, composer-props
 *
 * Exports:
 * - default — `App`（入口挂载的根组件）。
 *
 * Inward（本模块组装）: `PairingScreen`, `AppShell`；多处 `use*` hooks（bootstrap / session / submit / runtime / uploads 等）；
 *   `session-utils`、`api`、`AppState` reducer。
 *
 * Outward（谁消费）: 应用入口（如 `main`）仅挂载本 default；DOM 拼装见 `AppShell.jsx`。
 *
 * 不负责: 页面区域的具体布局与样式、`Composer`/`ChatPane` 内部交互实现。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { apiFetch, getToken } from '../api.js';
import { DEFAULT_PERMISSION_MODE } from '../composer/Composer.jsx';
import { DEFAULT_MODEL_SPEED, normalizeModelSpeed } from '../composer/composer-options.js';
import { useComposerSelections } from '../composer/useComposerSelections.js';
import { useQueueDrafts } from '../composer/useQueueDrafts.js';
import { connectionRecoveryState } from '../connection-recovery.js';
import { mergeContextStatus, normalizeContextStatus } from './context-status.js';
import { DEFAULT_REASONING_EFFORT, DEFAULT_STATUS, REASONING_DEFAULT_VERSION } from './defaults.js';
import { appReducer, createInitialUiState, THEME_KEY } from './AppState.js';
import { useNotifications } from '../panels/useNotifications.js';
import { useAppBootstrap } from './useAppBootstrap.js';
import { useConnectionActions } from './useConnectionActions.js';
import { useDocsActions } from './useDocsActions.js';
import { useFileUploads } from './useFileUploads.js';
import { useAppWebSocket } from './useAppWebSocket.js';
import { upsertActivityMessage } from '../chat/activity-model.js';
import { useSessionLivePolling } from './useSessionLivePolling.js';
import { useSessionActions } from './useSessionActions.js';
import { useTurnSubmission } from './useTurnSubmission.js';
import { useTurnRuntime } from './useTurnRuntime.js';
import { useViewportSizing } from './useViewportSizing.js';
import { usePwaUpdate } from './pwa-update.js';
import { applyPwaTheme } from './pwa-theme.js';
import { mergeModelSettingsIntoStatus, nextSyncedComposerSettings } from './model-sync.js';
import { rememberSelectedSession } from './selection-persistence.js';
import {
  emptyContextStatus,
  hasRunningKey,
  isDraftSession,
  reconcileThreadRuntimeWithSessions,
  selectedRunKeys,
  selectedSessionIsRunning,
  upsertSessionInProject
} from './session-utils.js';
import { AppShell } from './AppShell.jsx';
import PairingScreen from './PairingScreen.jsx';
import {
  selectRuntimeForSession,
  syncRunningByIdFromRuntime
} from '../sync/sync-selectors.js';

const MODEL_SPEED_KEY = 'codexmobile.modelSpeed';

export default function App() {
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [contextStatus, setContextStatus] = useState(() => normalizeContextStatus(DEFAULT_STATUS.context));
  const [authenticated, setAuthenticated] = useState(Boolean(getToken()));
  const [uiState, dispatchUi] = useReducer(appReducer, undefined, () => createInitialUiState());
  const setDrawerOpen = useCallback((value) => dispatchUi({ type: 'ui/drawerOpen', value }), []);
  const setPreviewImage = useCallback((value) => dispatchUi({ type: 'ui/previewImage', value }), []);
  const setDocsOpen = useCallback((value) => dispatchUi({ type: 'ui/docsOpen', value }), []);
  const setDocsBusy = useCallback((value) => dispatchUi({ type: 'ui/docsBusy', value }), []);
  const setDocsError = useCallback((value) => dispatchUi({ type: 'ui/docsError', value }), []);
  const setGitPanel = useCallback((value) => dispatchUi({ type: 'ui/gitPanel', value }), []);
  const setTheme = useCallback((value) => dispatchUi({ type: 'ui/theme', value }), []);
  const { drawerOpen, previewImage, docsOpen, docsBusy, docsError, gitPanel, theme } = uiState;
  const {
    toasts,
    notificationSupported,
    notificationEnabled,
    dismissToast,
    showToast,
    enableNotifications
  } = useNotifications();
  const pwaUpdate = usePwaUpdate();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState({});
  const [sessionsByProject, setSessionsByProject] = useState({});
  const [loadingProjectId, setLoadingProjectId] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionLoadingId, setSessionLoadingId] = useState(null);
  const [sessionLoadError, setSessionLoadError] = useState('');
  const [activityClockNow, setActivityClockNow] = useState(() => Date.now());
  const [completedSessionIds, setCompletedSessionIds] = useState({});
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [permissionMode, setPermissionMode] = useState(DEFAULT_PERMISSION_MODE);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_STATUS.model);
  const [selectedModelSpeed, setSelectedModelSpeed] = useState(() => normalizeModelSpeed(localStorage.getItem(MODEL_SPEED_KEY)));
  const [selectedCollaborationMode, setSelectedCollaborationMode] = useState(null);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(() => {
    const defaultVersion = localStorage.getItem('codexmobile.reasoningDefaultVersion');
    if (defaultVersion !== REASONING_DEFAULT_VERSION) {
      localStorage.setItem('codexmobile.reasoningDefaultVersion', REASONING_DEFAULT_VERSION);
      localStorage.setItem('codexmobile.reasoningEffort', DEFAULT_REASONING_EFFORT);
      return DEFAULT_REASONING_EFFORT;
    }
    return localStorage.getItem('codexmobile.reasoningEffort') || DEFAULT_REASONING_EFFORT;
  });
  const {
    fileMentions,
    setFileMentions,
    selectedSkillPaths,
    setSelectedSkillPaths,
    toggleSelectedSkill,
    selectSkill,
    clearSelectedSkills,
    addFileMention,
    removeFileMention
  } = useComposerSelections(status);
  const [runningById, setRunningById] = useState({});
  const [threadRuntimeById, setThreadRuntimeById] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [desktopHandoffPending, setDesktopHandoffPending] = useState(false);
  const [connectionState, setConnectionState] = useState(() => (getToken() ? 'connecting' : 'disconnected'));
  const wsRef = useRef(null);
  const selectedProjectRef = useRef(null);
  const selectedSessionRef = useRef(null);
  const messagesRef = useRef([]);
  const autoTitleSyncRef = useRef(new Set());
  const runningByIdRef = useRef({});
  const turnRefreshTimersRef = useRef(new Map());
  const lastStatusSettingsRef = useRef({
    model: DEFAULT_STATUS.model,
    reasoningEffort: DEFAULT_STATUS.reasoningEffort || DEFAULT_REASONING_EFFORT
  });
  const selectedModelRef = useRef(selectedModel);
  const selectedReasoningEffortRef = useRef(selectedReasoningEffort);
  const modelSettingsRequestRef = useRef(0);
  const modelSettingsSyncQueueRef = useRef(Promise.resolve());
  const sessionLivePollRef = useRef(false);
  const bootstrapStartedRef = useRef(false);
  const drawerSyncAtRef = useRef(0);
  const composerRef = useRef(null);
  const {
    queueDrafts,
    loadQueueDrafts,
    removeQueueDraft,
    restoreQueueDraft,
    steerQueueDraft
  } = useQueueDrafts({
    selectedSessionRef,
    selectedProjectRef,
    selectedProject,
    setInput,
    setAttachments,
    setFileMentions,
    setSelectedSkillPaths
  });

  useViewportSizing(composerRef);

  const syncRunningById = useMemo(() => syncRunningByIdFromRuntime(threadRuntimeById), [threadRuntimeById]);
  const selectedRuntime = selectRuntimeForSession(selectedSession, threadRuntimeById);
  const running =
    hasRunningKey(syncRunningById, selectedRunKeys(selectedSession)) ||
    selectedRuntime?.status === 'running' ||
    selectedRuntime?.status === 'queued';
  const selectedRunning = selectedSessionIsRunning({ running });
  const drawerRunningById = syncRunningById;
  const selectedActiveRunKeys = useMemo(() => {
    if (!selectedRunning) {
      return [];
    }
    const keys = new Set();
    if (selectedSession?.id) {
      keys.add(selectedSession.id);
    }
    if (selectedSession?.turnId) {
      keys.add(selectedSession.turnId);
    }
    if (selectedRuntime?.turnId) {
      keys.add(selectedRuntime.turnId);
    }
    if (!keys.size && selectedSession?.id) {
      keys.add(selectedSession.id);
    }
    return [...keys];
  }, [selectedRunning, selectedRuntime?.turnId, selectedSession?.id, selectedSession?.turnId]);

  useEffect(() => {
    loadQueueDrafts(selectedSession).catch(() => null);
  }, [selectedSession?.id]);

  useEffect(() => {
    setThreadRuntimeById((current) => {
      const next = reconcileThreadRuntimeWithSessions(current, sessionsByProject);
      return next === current ? current : next;
    });
  }, [sessionsByProject]);

  useEffect(() => {
    if (!selectedRunning) {
      return undefined;
    }
    setActivityClockNow(Date.now());
    const timer = window.setInterval(() => setActivityClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [selectedRunning]);

  const {
    markRun,
    clearRun,
    markSessionCompleteNotice,
    clearSessionCompleteNotice,
    markTurnCompleted,
    scheduleTurnRefresh
  } = useTurnRuntime({
    defaultStatus: DEFAULT_STATUS,
    turnRefreshTimersRef,
    selectedSessionRef,
    runningByIdRef,
    setRunningById,
    setThreadRuntimeById,
    setCompletedSessionIds,
    setMessages,
    setContextStatus
  });

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => {
    rememberSelectedSession(
      selectedSession?.projectId || selectedProject?.id
        ? { ...selectedSession, projectId: selectedSession?.projectId || selectedProject?.id }
        : selectedSession
    );
  }, [selectedProject?.id, selectedSession?.draft, selectedSession?.id, selectedSession?.projectId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useSessionLivePolling({
    authenticated,
    selectedSession,
    running,
    defaultStatus: DEFAULT_STATUS,
    sessionLivePollRef,
    selectedSessionRef,
    setContextStatus,
    setMessages
  });

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    applyPwaTheme(theme);
    if (theme !== 'system' || typeof window === 'undefined') {
      return undefined;
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) {
      return undefined;
    }
    const syncSystemTheme = () => applyPwaTheme('system');
    if (media.addEventListener) {
      media.addEventListener('change', syncSystemTheme);
    } else {
      media.addListener?.(syncSystemTheme);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', syncSystemTheme);
      } else {
        media.removeListener?.(syncSystemTheme);
      }
    };
  }, [theme]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    selectedReasoningEffortRef.current = selectedReasoningEffort;
    if (selectedReasoningEffort) {
      localStorage.setItem('codexmobile.reasoningEffort', selectedReasoningEffort);
    }
  }, [selectedReasoningEffort]);

  useEffect(() => {
    localStorage.setItem(MODEL_SPEED_KEY, normalizeModelSpeed(selectedModelSpeed || DEFAULT_MODEL_SPEED));
  }, [selectedModelSpeed]);

  useEffect(() => {
    const previous = lastStatusSettingsRef.current;
    const next = nextSyncedComposerSettings({
      currentModel: selectedModel,
      previousStatusModel: previous.model,
      statusModel: status.model,
      fallbackModel: DEFAULT_STATUS.model,
      currentReasoningEffort: selectedReasoningEffort,
      previousStatusReasoningEffort: previous.reasoningEffort,
      statusReasoningEffort: status.reasoningEffort,
      fallbackReasoningEffort: DEFAULT_REASONING_EFFORT
    });
    lastStatusSettingsRef.current = {
      model: status.model || previous.model,
      reasoningEffort: status.reasoningEffort || previous.reasoningEffort
    };
    if (next.model && next.model !== selectedModel) {
      setSelectedModel(next.model);
    }
    if (next.reasoningEffort && next.reasoningEffort !== selectedReasoningEffort) {
      setSelectedReasoningEffort(next.reasoningEffort);
    }
  }, [selectedModel, selectedReasoningEffort, status.model, status.reasoningEffort]);

  useEffect(() => {
    const model = selectedSession?.model;
    const reasoningEffort = selectedSession?.reasoningEffort;
    if (!model && !reasoningEffort) {
      return;
    }
    setStatus((current) =>
      mergeModelSettingsIntoStatus(current, {
        provider: selectedSession?.provider,
        model,
        reasoningEffort,
        sessionId: selectedSession?.id
      })
    );
  }, [selectedSession?.id, selectedSession?.model, selectedSession?.reasoningEffort, selectedSession?.provider]);

  const {
    loadStatus,
    loadSessions,
    loadProjects,
    bootstrap
  } = useAppBootstrap({
    defaultStatus: DEFAULT_STATUS,
    selectedProjectRef,
    selectedSessionRef,
    setStatus,
    setAuthenticated,
    setSelectedSession,
    setMessages,
    setContextStatus,
    setLoadingProjectId,
    setSessionsByProject,
    setProjects,
    setSelectedProject,
    setExpandedProjectIds
  });

  const syncModelSettings = useCallback(async ({ model, reasoningEffort }) => {
    const next = {
      model: model || selectedModelRef.current || DEFAULT_STATUS.model,
      reasoningEffort: reasoningEffort || selectedReasoningEffortRef.current || DEFAULT_REASONING_EFFORT
    };
    const requestId = modelSettingsRequestRef.current + 1;
    modelSettingsRequestRef.current = requestId;
    setStatus((current) => mergeModelSettingsIntoStatus(current, next));
    const task = modelSettingsSyncQueueRef.current.catch(() => null).then(async () => {
      const data = await apiFetch('/api/model-settings', {
        method: 'POST',
        body: {
          ...next,
          sessionId: selectedSessionRef.current?.id || null
        }
      });
      if (modelSettingsRequestRef.current === requestId && data.settings) {
        setStatus((current) => mergeModelSettingsIntoStatus(current, data.settings));
      }
      if (data.desktopSync?.attempted && !data.desktopSync?.synced) {
        showToast({
          level: 'warning',
          title: '模型已保存',
          body: '桌面端当前线程没有立即接收模型设置，后续会按配置同步。'
        });
      }
    });
    modelSettingsSyncQueueRef.current = task;
    try {
      await task;
    } catch (error) {
      showToast({
        level: 'error',
        title: '模型同步失败',
        body: error.message || '无法同步模型设置。'
      });
      loadStatus().catch(() => null);
    }
  }, [loadStatus, showToast]);

  const handleSelectModel = useCallback((model) => {
    setSelectedModel(model);
    selectedModelRef.current = model;
    syncModelSettings({ model, reasoningEffort: selectedReasoningEffortRef.current });
  }, [syncModelSettings]);

  const handleSelectReasoningEffort = useCallback((reasoningEffort) => {
    setSelectedReasoningEffort(reasoningEffort);
    selectedReasoningEffortRef.current = reasoningEffort;
    syncModelSettings({ model: selectedModelRef.current, reasoningEffort });
  }, [syncModelSettings]);

  useEffect(() => {
    if (bootstrapStartedRef.current) {
      return;
    }
    bootstrapStartedRef.current = true;
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!drawerOpen || !authenticated) {
      return undefined;
    }
    const now = Date.now();
    if (now - drawerSyncAtRef.current < 6000) {
      return undefined;
    }
    drawerSyncAtRef.current = now;
    let stopped = false;
    apiFetch('/api/sync', { method: 'POST' })
      .then(async () => {
        if (stopped) {
          return;
        }
        await loadStatus();
        if (!stopped) {
          await loadProjects({ preserveSelection: true, silent: true });
        }
      })
      .catch(() => null);
    return () => {
      stopped = true;
    };
  }, [authenticated, drawerOpen, loadProjects, loadStatus]);

  const {
    handleToggleProject,
    handleSelectSession,
    handleRenameSession,
    handleDeleteSession,
    handleDeleteMessage,
    handleNewConversation
  } = useSessionActions({
    defaultStatus: DEFAULT_STATUS,
    selectedProject,
    selectedProjectRef,
    selectedSessionRef,
    projects,
    sessionsByProject,
    expandedProjectIds,
    messages,
    messagesRef,
    autoTitleSyncRef,
    setExpandedProjectIds,
    setProjects,
    setSelectedProject,
    setSelectedSession,
    setSessionsByProject,
    setMessages,
    setSessionLoadingId,
    setSessionLoadError,
    setContextStatus,
    setAttachments,
    setInput,
    setDrawerOpen,
    loadSessions,
    upsertSessionInProject,
    clearSessionCompleteNotice
  });

  useAppWebSocket({
    useEffect,
    authenticated,
    defaultStatus: DEFAULT_STATUS,
    wsRef,
    selectedProjectRef,
    selectedSessionRef,
    setConnectionState,
    setStatus,
    markRun,
    clearRun,
    markSessionCompleteNotice,
    markTurnCompleted,
    scheduleTurnRefresh,
    upsertSessionInProject,
    setRunningById,
    runningByIdRef,
    setThreadRuntimeById,
    setSelectedSession,
    setSessionsByProject,
    setMessages,
    setContextStatus,
    setProjects,
    setSelectedProject,
    setExpandedProjectIds,
    loadSessions
  });

  const {
    handleSync,
    handleRetryConnection,
    handleResetPairing,
    handleShowConnectionStatus
  } = useConnectionActions({
    apiFetch,
    status,
    connectionState,
    setAuthenticated,
    setConnectionState,
    setSyncing,
    loadStatus,
    loadProjects,
    showToast
  });

  const {
    handleUploadFiles,
    handleRemoveAttachment
  } = useFileUploads({
    setUploading,
    setAttachments,
    setMessages
  });

  const {
    handleSubmit,
    handleImplementPlan,
    handleAdjustPlan,
    handleAbort
  } = useTurnSubmission({
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
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
    runningById: syncRunningById,
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
  });

  async function handleGitAction(action) {
    if (!selectedProject || selectedRunning) {
      return;
    }
    setGitPanel({ open: true, action });
  }

  const {
    handleConnectDocs,
    handleDisconnectDocs,
    handleRefreshDocs,
    handleOpenDocsHome,
    handleOpenDocsAuth
  } = useDocsActions({
    docsBusy,
    status,
    setStatus,
    setDocsBusy,
    setDocsError,
    loadStatus
  });

  const shellClass = useMemo(() => (drawerOpen ? 'app-shell drawer-active' : 'app-shell'), [drawerOpen]);
  const visibleContextStatus = useMemo(
    () => {
      if (!selectedSession || isDraftSession(selectedSession)) {
        return emptyContextStatus();
      }
      return normalizeContextStatus(contextStatus || selectedSession.context || DEFAULT_STATUS.context, DEFAULT_STATUS.context);
    },
    [contextStatus, selectedSession]
  );
  const recoveryState = connectionRecoveryState({
    authenticated,
    connectionState,
    desktopBridge: status.desktopBridge,
    syncing
  });
  const topBarRuntime = selectedRuntime || (selectedRunning ? { status: 'running' } : null);

  const handleComposerSubmit = useCallback(async (options = {}) => {
    const collaborationMode = options.collaborationMode || selectedCollaborationMode || null;
    const accepted = await handleSubmit({ ...options, collaborationMode });
    if (accepted && collaborationMode) {
      setSelectedCollaborationMode(null);
    }
  }, [handleSubmit, selectedCollaborationMode]);

  const handleCompactContext = useCallback(async () => {
    const project = selectedProjectRef.current || selectedProject;
    const session = selectedSessionRef.current || selectedSession;
    if (!project?.id || !session?.id || isDraftSession(session)) {
      showToast({
        level: 'warning',
        title: '无法压缩上下文',
        body: '请先打开一个已有线程。'
      });
      return false;
    }
    const actionId = globalThis.crypto?.randomUUID?.() || `manual-context-compaction-${Date.now()}`;
    const startedAt = new Date().toISOString();
    setMessages((current) => upsertActivityMessage(current, {
      projectId: project.id,
      sessionId: session.id,
      messageId: actionId,
      kind: 'context_compaction',
      status: 'running',
      label: '正在压缩上下文',
      startedAt,
      timestamp: startedAt
    }));
    showToast({
      level: 'info',
      title: '正在压缩上下文',
      body: '移动端会同步显示压缩进度。'
    });
    try {
      await apiFetch('/api/chat/compact', {
        method: 'POST',
        timeoutMs: 35_000,
        body: {
          projectId: project.id,
          sessionId: session.id,
          clientActionId: actionId
        }
      });
      const timestamp = new Date().toISOString();
      setMessages((current) => upsertActivityMessage(current, {
        projectId: project.id,
        sessionId: session.id,
        messageId: actionId,
        kind: 'context_compaction',
        status: 'completed',
        label: '上下文已压缩',
        startedAt,
        completedAt: timestamp,
        timestamp
      }));
      setContextStatus((current) => mergeContextStatus(current, {
        autoCompact: {
          detected: true,
          status: 'detected',
          lastCompactedAt: timestamp,
          reason: '手动压缩上下文'
        },
        updatedAt: timestamp
      }, DEFAULT_STATUS.context));
      showToast({
        level: 'success',
        title: '上下文已压缩',
        body: '当前线程的压缩结果已同步。'
      });
      return true;
    } catch (error) {
      const failedAt = new Date().toISOString();
      setMessages((current) => upsertActivityMessage(current, {
        projectId: project.id,
        sessionId: session.id,
        messageId: actionId,
        kind: 'context_compaction',
        status: 'failed',
        label: '上下文压缩失败',
        detail: error.message || '桌面端没有完成上下文压缩。',
        startedAt,
        completedAt: failedAt,
        timestamp: failedAt
      }));
      showToast({
        level: 'error',
        title: '压缩失败',
        body: error.message || '桌面端没有完成上下文压缩。'
      });
      return false;
    }
  }, [selectedProject, selectedSession, showToast]);

  const handleDesktopHandoff = useCallback(async () => {
    const session = selectedSessionRef.current || selectedSession;
    if (!session?.id || isDraftSession(session)) {
      showToast({
        level: 'warning',
        title: '暂时不能回到桌面',
        body: '请先打开一个已创建的对话。'
      });
      return false;
    }
    if (selectedRunning) {
      showToast({
        level: 'warning',
        title: '执行完成后再回到桌面',
        body: '当前对话还在执行中，完成后再打开桌面端更安全。'
      });
      return false;
    }
    setDesktopHandoffPending(true);
    try {
      await apiFetch('/api/desktop-handoff', {
        method: 'POST',
        timeoutMs: 12_000,
        body: { sessionId: session.id }
      });
      showToast({
        level: 'success',
        title: '已重启桌面端',
        body: 'Codex 桌面端会重新进入当前对话。'
      });
      return true;
    } catch (error) {
      showToast({
        level: 'error',
        title: '桌面端打开失败',
        body: error.message || '请确认 Mac 上已安装并可打开 Codex.app。'
      });
      return false;
    } finally {
      setDesktopHandoffPending(false);
    }
  }, [selectedSession, selectedRunning, showToast]);

  if (!authenticated) {
    return <PairingScreen onPaired={bootstrap} />;
  }

  const sessionLoading = Boolean(sessionLoadingId && selectedSession?.id === sessionLoadingId);
  const panelProps = {
    topBarProps: {
      selectedProject,
      selectedSession,
      connectionState,
      desktopBridge: status.desktopBridge,
      selectedRuntime: topBarRuntime,
      onMenu: () => setDrawerOpen(true),
      onOpenDocs: () => setDocsOpen(true),
      onGitAction: handleGitAction,
      onDesktopHandoff: handleDesktopHandoff,
      desktopHandoffSupported: status.desktopRefresh?.supported !== false,
      desktopHandoffPending,
      notificationSupported,
      notificationEnabled,
      onEnableNotifications: enableNotifications,
      gitDisabled: !selectedProject || selectedRunning
    },
    docsPanelProps: {
      open: docsOpen,
      docs: status.docs,
      busy: docsBusy,
      error: docsError,
      onClose: () => setDocsOpen(false),
      onConnect: handleConnectDocs,
      onDisconnect: handleDisconnectDocs,
      onOpenHome: handleOpenDocsHome,
      onOpenAuth: handleOpenDocsAuth,
      onRefresh: handleRefreshDocs
    },
    gitPanelProps: {
      open: gitPanel.open,
      action: gitPanel.action,
      project: selectedProject,
      onToast: showToast,
      onClose: () => setGitPanel((current) => ({ ...current, open: false }))
    },
    recoveryCardProps: {
      state: recoveryState,
      onRetry: handleRetryConnection,
      onSync: handleSync,
      onPair: handleResetPairing,
      onStatus: handleShowConnectionStatus
    },
    toastStackProps: {
      toasts,
      onDismiss: dismissToast
    },
    pwaUpdateProps: {
      available: pwaUpdate.available,
      onRefresh: pwaUpdate.refresh,
      onDismiss: pwaUpdate.dismiss
    },
    imagePreviewProps: {
      image: previewImage,
      onClose: () => setPreviewImage(null)
    }
  };
  const drawerProps = {
    open: drawerOpen,
    onClose: () => setDrawerOpen(false),
    projects,
    selectedProject,
    selectedSession,
    expandedProjectIds,
    sessionsByProject,
    loadingProjectId,
    runningById: drawerRunningById,
    threadRuntimeById,
    completedSessionIds,
    onToggleProject: handleToggleProject,
    onSelectSession: handleSelectSession,
    onRenameSession: handleRenameSession,
    onDeleteSession: handleDeleteSession,
    onNewConversation: handleNewConversation,
    onSync: handleSync,
    syncing,
    theme,
    setTheme,
    runtimeDebug: status.runtimeDebug,
    desktopRefresh: status.desktopRefresh,
    refreshStatus: loadStatus
  };
  const chatProps = {
    messages,
    selectedSession,
    loading: sessionLoading,
    loadError: sessionLoadError,
    running: selectedRunning,
    activeRunKeys: selectedActiveRunKeys,
    activeRuntimeStartedAt: selectedRuntime?.startedAt || selectedRuntime?.updatedAt || null,
    now: activityClockNow,
    onPreviewImage: setPreviewImage,
    onDeleteMessage: handleDeleteMessage,
    onImplementPlan: handleImplementPlan,
    onAdjustPlan: handleAdjustPlan
  };
  const composerProps = {
    composerRef,
    input,
    setInput,
    selectedProject,
    selectedSession,
    onSubmit: handleComposerSubmit,
    running: selectedRunning,
    onAbort: handleAbort,
    models: status.models,
    selectedModel,
    onSelectModel: handleSelectModel,
    selectedModelSpeed,
    onSelectModelSpeed: (value) => setSelectedModelSpeed(normalizeModelSpeed(value)),
    selectedReasoningEffort,
    onSelectReasoningEffort: handleSelectReasoningEffort,
    selectedCollaborationMode,
    onSelectCollaborationMode: setSelectedCollaborationMode,
    skills: status.skills,
    selectedSkillPaths,
    onToggleSkill: toggleSelectedSkill,
    onSelectSkill: selectSkill,
    onClearSkills: clearSelectedSkills,
    permissionMode,
    onSelectPermission: setPermissionMode,
    attachments,
    onUploadFiles: handleUploadFiles,
    onRemoveAttachment: handleRemoveAttachment,
    fileMentions,
    onAddFileMention: addFileMention,
    onRemoveFileMention: removeFileMention,
    uploading,
    contextStatus: visibleContextStatus,
    runSteerable: selectedRuntime?.steerable !== false,
    desktopBridge: status.desktopBridge,
    queueDrafts,
    onRestoreQueueDraft: restoreQueueDraft,
    onRemoveQueueDraft: removeQueueDraft,
    onSteerQueueDraft: steerQueueDraft,
    onCompactContext: handleCompactContext
  };

  return (
    <AppShell
      shellClass={shellClass}
      panelProps={panelProps}
      drawerProps={drawerProps}
      chatProps={chatProps}
      composerProps={composerProps}
    />
  );
}
