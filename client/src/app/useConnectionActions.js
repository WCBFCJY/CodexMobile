/**
 * 连接与用户会话操作：登出清除 token、同步桌面桥、刷新状态与项目列表等聚合回调。
 *
 * Keywords: connection-actions, logout, sync, bridge
 *
 * Exports:
 * - `useConnectionActions` — 返回连接/同步相关 `handle*` 的 hook。
 *
 * Inward: `api`（经 props 注入 `apiFetch` 等）、panels 中的桥接展示文案。
 *
 * Outward: `App.jsx` TopBar 与恢复卡片等。
 */

import { clearToken } from '../api.js';
import { bridgeConnectionLabel } from '../panels/index.js';
import { sessionMessagesApiPath } from './session-utils.js';

export function useConnectionActions({
  apiFetch,
  status,
  connectionState,
  setAuthenticated,
  setConnectionState,
  setSyncing,
  loadStatus,
  loadProjects,
  showToast,
  selectedSession,
  setMessages
}) {
  async function handleSync() {
    setSyncing(true);
    try {
      await apiFetch('/api/sync', { method: 'POST' });
      await loadStatus();
      await loadProjects({ preserveSelection: true, preloadSessions: true });
      // 重新加载当前会话消息，清除前端临时追加的消息（如 turn.failed）
      if (selectedSession?.id && !selectedSession.draft) {
        try {
          const data = await apiFetch(sessionMessagesApiPath(selectedSession.id));
          setMessages(data.messages || []);
        } catch (_) { /* 忽略，不影响同步完成 */ }
      }

    } catch (error) {
      showToast({ level: 'error', title: '同步失败', body: error.message || '无法刷新同步。' });
    } finally {
      setSyncing(false);
    }
  }

  async function handleRetryConnection() {
    try {
      await loadStatus();
      showToast({ level: 'success', title: '连接已刷新', body: '已重新读取本机服务状态。' });
    } catch (error) {
      showToast({ level: 'error', title: '连接失败', body: error.message || '本机服务暂时不可达。' });
    }
  }

  function handleResetPairing() {
    clearToken();
    setAuthenticated(false);
    setConnectionState('disconnected');
  }

  function handleShowConnectionStatus() {
    showToast({
      level: connectionState === 'connected' ? 'info' : 'warning',
      title: bridgeConnectionLabel(connectionState).label,
      body: 'CodexMobile 状态已读取。'
    });
  }

  return {
    handleSync,
    handleRetryConnection,
    handleResetPairing,
    handleShowConnectionStatus
  };
}
