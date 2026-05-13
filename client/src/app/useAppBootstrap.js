/**
 * 应用冷启动与认证后装载：拉取 `status`、项目与会话列表，按本地 remembered 选择恢复选中项并拉取首屏消息。
 *
 * Keywords: bootstrap, load-status, session-restore
 *
 * Exports:
 * - `useAppBootstrap` — `loadStatus`、`loadProjects` 等启动向方法集合的 hook。
 *
 * Inward: `api`；`session-utils`、`context-status`、`selection-persistence`。
 *
 * Outward: `App.jsx` 首次与重登后的数据装载。
 */

import { useCallback } from 'react';
import { apiFetch, clearToken } from '../api.js';
import {
  emptyContextStatus,
  isDraftSession,
  sessionMessagesApiPath
} from './session-utils.js';
import { normalizeContextStatus } from './context-status.js';
import {
  preferredProjectFromStoredSelection,
  readStoredSelection,
  selectedSessionFromStoredSelection
} from './selection-persistence.js';

export function useAppBootstrap({
  defaultStatus,
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
          setContextStatus(emptyContextStatus());
          return;
        }
        setSelectedSession((current) => (current?.id === next.id ? { ...current, ...next } : next));
        setContextStatus(normalizeContextStatus(next.context || defaultStatus.context, defaultStatus.context));
        const messageData = await apiFetch(sessionMessagesApiPath(next.id));
        if (selectedSessionRef.current?.id === next.id) {
          setMessages(messageData.messages || []);
          setContextStatus(normalizeContextStatus(messageData.context || next.context || defaultStatus.context, defaultStatus.context));
        }
        return;
      }
      selectedSessionRef.current = null;
      setSelectedSession(null);
      setMessages([]);
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
    setMessages,
    setSelectedSession,
    setSessionsByProject
  ]);

  const loadProjects = useCallback(async (options = {}) => {
    const preserveSelection = Boolean(options?.preserveSelection);
    const refreshSessions = options?.refreshSessions !== false;
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
