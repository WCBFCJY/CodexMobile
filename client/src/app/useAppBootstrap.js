/**
 * 应用冷启动与认证后装载：拉取 `status`、项目、会话、消息与 pending 交互请求。
 *
 * Keywords: bootstrap, load-status, session-restore
 *
 * Exports:
 * - `projectsToPreloadForSidebar` — 计算侧栏同步后需要静默补齐会话的项目。
 * - `useAppBootstrap` — `loadStatus`、`loadProjects` 等启动向方法集合的 hook。
 *
 * Inward: `api`；`session-utils`、`context-status`、`interaction-model`、`selection-persistence`。
 *
 * Outward: `App.jsx` 首次与重登后的数据装载。
 */

import { useCallback } from 'react';
import { apiFetch, clearToken } from '../api.js';
import { upsertInteractionRequestMessage } from '../chat/interaction-model.js';
import {
  emptyContextStatus,
  emptyMessagePage,
  isDraftSession,
  messagePageFromResponse,
  sessionMessagesApiPath
} from './session-utils.js';
import { normalizeContextStatus } from './context-status.js';
import {
  preferredProjectFromStoredSelection,
  readStoredSelection,
  selectedSessionFromStoredSelection
} from './selection-persistence.js';

export function projectsToPreloadForSidebar(projects = [], preferredProjectId = '') {
  return projects
    .filter((project) => project?.id && project.id !== preferredProjectId && Number(project.sessionCount || 0) > 0)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

export function useAppBootstrap({
  defaultStatus,
  selectedProjectRef,
  selectedSessionRef,
  setStatus,
  setAuthenticated,
  setSelectedSession,
  setMessages,
  setMessagePage,
  setContextStatus,
  setLoadingProjectId,
  setSessionsByProject,
  setProjects,
  setSelectedProject,
  setExpandedProjectIds
}) {
  const loadStatus = useCallback(async () => {
    const data = await apiFetch('/api/status');
    setStatus(data);
    setAuthenticated(Boolean(data.auth?.authenticated));
    return data;
  }, [setAuthenticated, setStatus]);

  const loadSessions = useCallback(async (project, options = true) => {
    const settings =
      typeof options === 'boolean'
        ? { chooseLatest: options, preserveSelection: false }
        : {
          chooseLatest: options?.chooseLatest ?? true,
          preferredSessionId: options?.preferredSessionId || '',
          preserveSelection: Boolean(options?.preserveSelection),
          silent: Boolean(options?.silent)
        };
    if (!project) {
      selectedSessionRef.current = null;
      setSelectedSession(null);
      setMessages([]);
      setMessagePage(emptyMessagePage());
      setContextStatus(emptyContextStatus());
      return;
    }
    if (!settings.silent) {
      setLoadingProjectId(project.id);
    }
    try {
      const data = await apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions`);
      const apiSessions = data.sessions || [];
      const currentSession = selectedSessionRef.current;
      const sameProjectCurrent =
        currentSession?.projectId === project.id ? currentSession : null;
      const selected = selectedSessionFromStoredSelection(apiSessions, {
        preserveSelection: settings.preserveSelection,
        currentSession: sameProjectCurrent,
        storedSessionId: settings.preferredSessionId,
        chooseLatest: settings.chooseLatest
      });
      const preserveCurrent = Boolean(selected && currentSession?.id === selected.id);
      const nextSessions =
        preserveCurrent && isDraftSession(currentSession)
          ? [currentSession, ...apiSessions.filter((session) => session.id !== currentSession.id)]
          : apiSessions;
      setSessionsByProject((current) => ({ ...current, [project.id]: nextSessions }));

      if (selected) {
        const next = isDraftSession(selected)
          ? selected
          : nextSessions.find((session) => session.id === selected.id) || selected;
        selectedSessionRef.current = next;
        if (isDraftSession(next)) {
          setSelectedSession(next);
          setMessages([]);
          setMessagePage(emptyMessagePage());
          setContextStatus(emptyContextStatus());
          return;
        }
        setSelectedSession((current) => (current?.id === next.id ? { ...current, ...next } : next));
        setContextStatus(normalizeContextStatus(next.context || defaultStatus.context, defaultStatus.context));
        const messageData = await apiFetch(sessionMessagesApiPath(next.id));
        if (selectedSessionRef.current?.id === next.id) {
          const pendingInteractions = await apiFetch(`/api/chat/interactions?sessionId=${encodeURIComponent(next.id)}`)
            .then((result) => result.interactions || [])
            .catch(() => []);
          setMessages(
            pendingInteractions.reduce(
              (current, interaction) => upsertInteractionRequestMessage(current, { interaction, sessionId: next.id, turnId: interaction.turnId }),
              messageData.messages || []
            )
          );
          setMessagePage(messagePageFromResponse(messageData));
          setContextStatus(normalizeContextStatus(messageData.context || next.context || defaultStatus.context, defaultStatus.context));
        }
        return;
      }
      selectedSessionRef.current = null;
      setSelectedSession(null);
      setMessages([]);
      setMessagePage(emptyMessagePage());
      setContextStatus(emptyContextStatus());
    } finally {
      if (!settings.silent) {
        setLoadingProjectId((current) => (current === project.id ? null : current));
      }
    }
  }, [
    defaultStatus,
    selectedSessionRef,
    setContextStatus,
    setLoadingProjectId,
    setMessagePage,
    setMessages,
    setSelectedSession,
    setSessionsByProject
  ]);

  const loadProjects = useCallback(async (options = {}) => {
    const preserveSelection = Boolean(options?.preserveSelection);
    const refreshSessions = options?.refreshSessions !== false;
    const preloadSessions = Boolean(options?.preloadSessions);
    const storedSelection = readStoredSelection();
    const data = await apiFetch('/api/projects');
    const list = data.projects || [];
    setProjects(list);
    const currentProject = selectedProjectRef.current;
    const preferred = preferredProjectFromStoredSelection(list, {
      preserveSelection,
      currentProject,
      storedProjectId: storedSelection.projectId
    });
    setSelectedProject(preferred);
    if (preferred) {
      setExpandedProjectIds((current) => ({ ...current, [preferred.id]: true }));
    }
    if (refreshSessions) {
      const shouldRestoreStoredSession = Boolean(
        preferred?.id &&
        storedSelection.projectId === preferred.id &&
        (!preserveSelection || !selectedSessionRef.current)
      );
      await loadSessions(preferred, {
        chooseLatest: !preserveSelection || !selectedSessionRef.current,
        preferredSessionId: shouldRestoreStoredSession ? storedSelection.sessionId : '',
        preserveSelection,
        silent: Boolean(options?.silent)
      });
    }
    if (preloadSessions) {
      const preferredProjectId = preferred?.id || '';
      const projectsToPreload = projectsToPreloadForSidebar(list, preferredProjectId);
      await Promise.all(projectsToPreload.map(async (project) => {
        try {
          const sessionData = await apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions`);
          setSessionsByProject((current) => ({ ...current, [project.id]: sessionData.sessions || [] }));
        } catch {
          // Keep sidebar refresh best-effort; the selected project path above remains authoritative.
        }
      }));
    }
  }, [loadSessions, selectedProjectRef, selectedSessionRef, setExpandedProjectIds, setProjects, setSelectedProject]);

  const bootstrap = useCallback(async () => {
    try {
      const currentStatus = await loadStatus();
      if (currentStatus.auth?.authenticated) {
        await loadProjects();
        apiFetch('/api/sync', { method: 'POST' })
          .then(async () => {
            await loadStatus();
            await loadProjects({ preserveSelection: true, refreshSessions: false });
          })
          .catch(() => null);
      }
    } catch (error) {
      if (String(error.message).includes('Pairing')) {
        clearToken();
        setAuthenticated(false);
      }
    }
  }, [loadProjects, loadStatus, setAuthenticated]);

  return {
    loadStatus,
    loadSessions,
    loadProjects,
    bootstrap
  };
}
