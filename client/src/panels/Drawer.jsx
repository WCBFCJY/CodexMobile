/**
 * 主侧栏抽屉：项目 / 会话列表、配额与设置入口、归档与子代理等。
 *
 * Keywords: drawer, sidebar, sessions, projects, settings
 *
 * Exports:
 * - Drawer — 侧栏根组件。
 *
 * Inward: apiFetch、runtime-debug-client、session-utils（路径展示与运行时摘要）；lucide-react。
 *
 * Outward: App 根布局在菜单打开时渲染。
 */

import { Archive, BarChart3, Check, ChevronDown, ChevronLeft, Folder, Loader2, MessageSquare, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { setClientRuntimeDebugEnabled } from '../app/runtime-debug-client.js';
import { compactPath, formatTime, sessionRunBadgeState, subAgentSubtitle } from '../app/session-utils.js';

function quotaPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return null;
  }
  return Math.max(0, Math.min(100, percent));
}

function quotaRemainingPercent(quotaWindow) {
  if (!quotaWindow || typeof quotaWindow !== 'object') {
    return null;
  }
  const display = quotaPercent(quotaWindow.displayPercent ?? quotaWindow.display_percent);
  if (display !== null) {
    return display;
  }
  const explicit = quotaPercent(quotaWindow.remainingPercent ?? quotaWindow.remaining_percent);
  if (explicit !== null) {
    return explicit;
  }
  const used = quotaPercent(quotaWindow.usedPercent ?? quotaWindow.used_percent);
  return used === null ? null : Math.max(0, Math.min(100, 100 - used));
}

function formatQuotaPercent(quotaWindow) {
  const percent = quotaRemainingPercent(quotaWindow);
  return percent === null ? '--' : `${Math.round(percent)}%`;
}

function quotaToneClass(percent) {
  if (percent === null) {
    return 'is-low';
  }
  if (percent >= 80) {
    return 'is-healthy';
  }
  if (percent >= 60) {
    return 'is-medium';
  }
  if (percent >= 40) {
    return 'is-warning';
  }
  return 'is-low';
}

function formatRelativeShort(value) {
  if (!value) {
    return '';
  }
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) {
    return '';
  }
  const diff = Date.now() - ts;
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h`;
  }
  if (diff < 7 * 86_400_000) {
    return `${Math.floor(diff / 86_400_000)}d`;
  }
  return formatTime(value);
}

export function Drawer({
  open,
  onClose,
  projects,
  selectedProject,
  selectedSession,
  expandedProjectIds,
  sessionsByProject,
  loadingProjectId,
  runningById,
  threadRuntimeById,
  completedSessionIds,
  onToggleProject,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onNewConversation,
  onSync,
  syncing,
  theme,
  setTheme,
  runtimeDebug,
  refreshStatus
}) {
  const [drawerView, setDrawerView] = useState('main');
  const [subagentExpandedById, setSubagentExpandedById] = useState({});
  const [quotaExpanded, setQuotaExpanded] = useState(false);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaLoaded, setQuotaLoaded] = useState(false);
  const [quotaError, setQuotaError] = useState('');
  const [quotaNotice, setQuotaNotice] = useState('');
  const [quotaAccounts, setQuotaAccounts] = useState([]);
  const [drawerQuery, setDrawerQuery] = useState('');
  const [threadActionMenu, setThreadActionMenu] = useState(null);
  const [renameDraft, setRenameDraft] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [runtimeDebugError, setRuntimeDebugError] = useState('');
  const [runtimeDebugSaving, setRuntimeDebugSaving] = useState(false);
  const normalizedDrawerQuery = drawerQuery.trim().toLowerCase();
  const runningCount = Object.values(sessionsByProject || {})
    .flatMap((sessions) => (Array.isArray(sessions) ? sessions : []))
    .filter((session) => sessionRunBadgeState(session, { runningById, threadRuntimeById, completedSessionIds }) === 'running')
    .length;
  const orderedProjects = [
    ...projects.filter((project) => project.projectless),
    ...projects.filter((project) => !project.projectless)
  ];
  const projectlessProject = orderedProjects.find((project) => project.projectless) || null;
  const projectChoices = orderedProjects.filter((project) => !project.projectless);

  useEffect(() => {
    if (!open) {
      setThreadActionMenu(null);
      setRenameDraft(null);
      setRenameValue('');
      setRenameSaving(false);
      setNewConversationOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!renameDraft) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setRenameDraft(null);
        setRenameValue('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [renameDraft]);

  function startNewConversation(project, event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (!project) {
      return;
    }
    setThreadActionMenu(null);
    setNewConversationOpen(false);
    onNewConversation(project);
  }

  function openThreadActionMenu(project, session, event) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(rect.right - 72, 92), window.innerWidth - 92);
    const y = Math.min(Math.max(rect.bottom + 6, 88), window.innerHeight - 116);
    setThreadActionMenu({ project, session, x, y });
  }

  function handleThreadRename() {
    if (!threadActionMenu) {
      return;
    }
    setRenameDraft({ project: threadActionMenu.project, session: threadActionMenu.session });
    setRenameValue(threadActionMenu.session?.title || '对话');
    setThreadActionMenu(null);
  }

  function closeRenameDialog() {
    if (renameSaving) {
      return;
    }
    setRenameDraft(null);
    setRenameValue('');
  }

  async function submitRenameDialog(event) {
    event.preventDefault();
    if (!renameDraft || renameSaving) {
      return;
    }
    const nextTitle = renameValue.trim().slice(0, 52);
    if (!nextTitle) {
      return;
    }
    if (nextTitle === (renameDraft.session?.title || '对话')) {
      closeRenameDialog();
      return;
    }
    setRenameSaving(true);
    try {
      const ok = await onRenameSession(renameDraft.project, renameDraft.session, nextTitle);
      if (ok !== false) {
        setRenameDraft(null);
        setRenameValue('');
      }
    } finally {
      setRenameSaving(false);
    }
  }

  function handleThreadArchive() {
    if (!threadActionMenu) {
      return;
    }
    onDeleteSession(threadActionMenu.project, threadActionMenu.session);
    setThreadActionMenu(null);
  }

  async function refreshCodexQuota(event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (quotaLoading) {
      return;
    }
    setQuotaExpanded(true);
    setQuotaLoading(true);
    setQuotaError('');
    setQuotaNotice('');
    try {
      const result = await apiFetch('/api/quotas/codex');
      setQuotaAccounts(Array.isArray(result.accounts) ? result.accounts : []);
      setQuotaNotice(result.stale ? (result.staleReason || '实时查询失败，显示最近一次成功结果') : '');
      setQuotaLoaded(true);
    } catch (error) {
      setQuotaError(`${error.message || '查询失败'}，点击刷新重试`);
      setQuotaLoaded(true);
    } finally {
      setQuotaLoading(false);
    }
  }

  function toggleQuotaPanel() {
    setQuotaExpanded((current) => !current);
  }

  useEffect(() => {
    if (!runtimeDebug) {
      return;
    }
    setClientRuntimeDebugEnabled(Boolean(runtimeDebug.uiEnabled));
  }, [runtimeDebug?.uiEnabled]);

  async function handleRuntimeDebugToggle(event) {
    const enabled = event.target.checked;
    setRuntimeDebugError('');
    setRuntimeDebugSaving(true);
    try {
      await apiFetch('/api/runtime-debug', { method: 'POST', body: { enabled } });
      setClientRuntimeDebugEnabled(enabled);
      await refreshStatus?.();
    } catch (error) {
      setRuntimeDebugError(error.message || '保存失败');
      await refreshStatus?.();
    } finally {
      setRuntimeDebugSaving(false);
    }
  }

  if (drawerView === 'settings') {
    return (
      <>
        <div className={`drawer-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} />
        <aside className={`drawer ${open ? 'is-open' : ''}`}>
          <div className="drawer-subheader">
            <button className="icon-button" onClick={() => setDrawerView('main')} aria-label="返回">
              <ChevronLeft size={22} />
            </button>
            <strong>设置</strong>
            <button className="icon-button" onClick={onClose} aria-label="关闭菜单">
              <X size={20} />
            </button>
          </div>
          <div className="settings-view">
            <section className="settings-group">
              <div className="drawer-heading">外观</div>
              <div className="theme-setting">
                <div className="theme-setting-title">
                  <span>主题选择</span>
                </div>
                <div className="theme-segment" role="group" aria-label="主题选择">
                  <button
                    type="button"
                    className={theme === 'light' ? 'is-selected' : ''}
                    onClick={() => setTheme('light')}
                  >
                    白色
                  </button>
                  <button
                    type="button"
                    className={theme === 'dark' ? 'is-selected' : ''}
                    onClick={() => setTheme('dark')}
                  >
                    黑色
                  </button>
                  <button
                    type="button"
                    className={theme === 'system' ? 'is-selected' : ''}
                    onClick={() => setTheme('system')}
                  >
                    跟随系统
                  </button>
                </div>
              </div>
            </section>
            <section className="settings-group">
              <div className="drawer-heading">开发与排查</div>
              <div className="theme-setting">
                <label className="setting-row">
                  <span>运行态调试日志</span>
                  <input
                    type="checkbox"
                    checked={Boolean(runtimeDebug?.uiEnabled)}
                    disabled={runtimeDebugSaving}
                    onChange={handleRuntimeDebugToggle}
                  />
                </label>
                <div className="theme-setting-title">
                  <small>
                    开启后服务端把运行态事件写入项目下的 {runtimeDebug?.logRelativePath || '.codexmobile/logs/runtime-debug.jsonl'}
                    （JSONL）；助手读取仓库时可直接打开该文件。浏览器控制台会同步输出 [runtime-debug][client]。
                  </small>
                  {runtimeDebug?.envEnabled ? (
                    <small>已通过环境变量 CODEXMOBILE_RUNTIME_DEBUG 启用（与本开关可同时生效）。</small>
                  ) : null}
                  {runtimeDebugError ? <small className="runtime-debug-error">{runtimeDebugError}</small> : null}
                </div>
              </div>
            </section>
          </div>
        </aside>
      </>
    );
  }

  const renderThreadRow = (project, session, { isSubAgent = false } = {}) => {
    const badgeState = sessionRunBadgeState(session, { runningById, threadRuntimeById, completedSessionIds });
    const sessionRunning = badgeState === 'running';
    const sessionCompleted = badgeState === 'complete';
    const childCount = Number(session.childCount) || 0;
    const openChildCount = Number(session.openChildCount) || 0;
    const subagentsOpen = Boolean(subagentExpandedById[session.id]);
    const rowSelected = selectedSession?.id === session.id;
    const metaText = session.draft
      ? '待发送'
      : (isSubAgent || session.isSubAgent)
        ? subAgentSubtitle(session)
        : formatRelativeShort(session.updatedAt);
    return (
      <div
        key={session.id}
        className={`thread-row ${rowSelected ? 'is-selected' : ''} ${session.draft ? 'is-draft' : ''} ${sessionRunning ? 'is-running' : ''} ${sessionCompleted ? 'has-complete-notice' : ''} ${isSubAgent || session.isSubAgent ? 'is-subagent' : ''}`}
      >
        <button
          type="button"
          className="thread-main"
          onClick={() => {
            setThreadActionMenu(null);
            onSelectSession(session);
          }}
        >
          <span className="thread-title-line">
            <span className="thread-title">{session.title || '对话'}</span>
            {!isSubAgent && childCount ? (
              <span
                role="button"
                tabIndex={0}
                className="thread-subagent-toggle"
                aria-label={subagentsOpen ? '折叠子代理线程' : '展开子代理线程'}
                aria-expanded={subagentsOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setSubagentExpandedById((current) => ({ ...current, [session.id]: !current[session.id] }));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    setSubagentExpandedById((current) => ({ ...current, [session.id]: !current[session.id] }));
                  }
                }}
              >
                {openChildCount ? `${openChildCount}/${childCount}` : childCount}
                <ChevronDown size={11} />
              </span>
            ) : null}
          </span>
        </button>
        <span className="thread-meta">
          {sessionRunning ? (
            <span className="thread-run-ring" aria-label="运行中" />
          ) : sessionCompleted ? (
            <span className="thread-complete-dot" aria-label="有新完成结果" />
          ) : metaText ? (
            <small>{metaText}</small>
          ) : null}
        </span>
        {rowSelected ? (
          <button
            type="button"
            className="thread-more-button"
            onClick={(event) => openThreadActionMenu(project, session, event)}
            aria-label="打开线程操作"
            aria-haspopup="menu"
            aria-expanded={threadActionMenu?.session?.id === session.id}
          >
            <MoreHorizontal size={16} />
          </button>
        ) : null}
      </div>
    );
  };

  const renderProjectGroup = (project) => {
    const isSelected = selectedProject?.id === project.id;
    const isExpanded = Boolean(expandedProjectIds[project.id]);
    const projectSessions = sessionsByProject[project.id] || [];
    const projectMatches = normalizedDrawerQuery
      ? [project.name, project.pathLabel, project.path].some((value) => String(value || '').toLowerCase().includes(normalizedDrawerQuery))
      : true;
    const visibleProjectSessions = normalizedDrawerQuery
      ? projectSessions.filter((session) => String(session.title || '对话').toLowerCase().includes(normalizedDrawerQuery))
      : projectSessions;
    if (normalizedDrawerQuery && !projectMatches && !visibleProjectSessions.length) {
      return null;
    }
    const projectSessionIds = new Set(visibleProjectSessions.map((session) => session.id));
    const childSessionsByParent = visibleProjectSessions.reduce((acc, session) => {
      if (session.parentSessionId && projectSessionIds.has(session.parentSessionId)) {
        if (!acc.has(session.parentSessionId)) {
          acc.set(session.parentSessionId, []);
        }
        acc.get(session.parentSessionId).push(session);
      }
      return acc;
    }, new Map());
    const rootSessions = visibleProjectSessions.filter(
      (session) => !session.parentSessionId || !projectSessionIds.has(session.parentSessionId)
    );
    const sessionsOpen = isExpanded || Boolean(normalizedDrawerQuery);
    const sessionCount = project.sessionCount ?? projectSessions.length ?? 0;
    return (
      <div key={project.id} className={`project-group ${project.projectless ? 'is-conversations' : 'is-project'}`}>
        <div className="project-row-shell">
          <button
            className={`project-row ${isSelected ? 'is-selected' : ''} ${sessionsOpen ? 'is-expanded' : ''}`}
            onClick={() => onToggleProject(project)}
          >
            {project.projectless ? <MessageSquare size={16} /> : <Folder size={16} />}
            <span className="project-name">
              {project.projectless ? '普通对话' : project.name}
            </span>
            {sessionCount ? <small className="project-count">{sessionCount}</small> : null}
            <ChevronDown size={14} className="project-chevron" />
          </button>
          <button
            type="button"
            className="project-add-button"
            onClick={(event) => startNewConversation(project, event)}
            aria-label={`新建${project.projectless ? '普通' : project.name}对话`}
            title="新建对话"
          >
            <Plus size={15} />
          </button>
        </div>
        {sessionsOpen ? (
          <div className="thread-list">
            {loadingProjectId === project.id ? (
              <div className="thread-empty">
                <Loader2 className="spin" size={13} />
                加载中
              </div>
            ) : visibleProjectSessions.length ? (
              rootSessions.map((session) => {
                const childSessions = childSessionsByParent.get(session.id) || [];
                const childSessionsOpen = Boolean(subagentExpandedById[session.id]);
                return (
                  <div key={session.id} className="thread-stack">
                    {renderThreadRow(project, session)}
                    {childSessions.length && childSessionsOpen ? (
                      <div className="thread-list is-subagents">
                        {childSessions.map((childSession) => renderThreadRow(project, childSession, { isSubAgent: true }))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="thread-empty">暂无线程</div>
            )}
          </div>
        ) : null}
      </div>
    );
  };
  const renderedProjectGroups = orderedProjects.map(renderProjectGroup).filter(Boolean);

  const statusText = runningCount ? `${runningCount} 个任务运行中` : '已连接';

  return (
    <>
      <div className={`drawer-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} />
      <aside className={`drawer ${open ? 'is-open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-brand">
            <img className="drawer-app-icon" src="/codex-icon-180.png" alt="" aria-hidden="true" />
            <span className="drawer-brand-name">CodexMobile</span>
          </div>
          <button className="drawer-header-action" onClick={onClose} aria-label="关闭菜单">
            <X size={16} />
          </button>
        </div>

        <label className="drawer-search">
          <Search size={14} />
          <input
            type="search"
            value={drawerQuery}
            onChange={(event) => setDrawerQuery(event.target.value)}
            placeholder="搜索对话"
            aria-label="搜索对话或项目"
          />
        </label>

        <div className="drawer-thread-browser">
          <button
            type="button"
            className={`drawer-new-row ${newConversationOpen ? 'is-open' : ''}`}
            onClick={() => setNewConversationOpen((current) => !current)}
            aria-expanded={newConversationOpen}
            title="选择新对话位置"
          >
            <Plus size={16} />
            <span>新对话</span>
            <ChevronDown size={14} />
          </button>

          {newConversationOpen ? (
            <div className="new-conversation-panel" aria-label="选择新对话位置">
              {projectlessProject ? (
                <button type="button" className="new-conversation-option" onClick={(event) => startNewConversation(projectlessProject, event)}>
                  <MessageSquare size={15} />
                  <span>
                    <strong>普通对话</strong>
                    <small>不绑定项目</small>
                  </span>
                </button>
              ) : null}
              {projectChoices.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="new-conversation-option"
                  onClick={(event) => startNewConversation(project, event)}
                >
                  <Folder size={15} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.pathLabel || compactPath(project.path)}</small>
                  </span>
                </button>
              ))}
              {!projectlessProject && !projectChoices.length ? (
                <div className="new-conversation-empty">暂无可用位置</div>
              ) : null}
            </div>
          ) : null}

          <div className="project-list">
            {renderedProjectGroups}
          </div>
          {normalizedDrawerQuery && !renderedProjectGroups.length ? (
            <div className="drawer-empty-state">没有匹配的对话或项目</div>
          ) : null}
        </div>

        {quotaExpanded ? (
          <div className="quota-panel">
            <div className="quota-panel-head">
              <span>额度查询 · Codex</span>
              <button
                type="button"
                className="quota-refresh"
                onClick={refreshCodexQuota}
                disabled={quotaLoading}
              >
                {quotaLoading ? <Loader2 className="spin" size={12} /> : null}
                {quotaLoading ? '刷新中' : '刷新'}
              </button>
            </div>
            {quotaError ? (
              <button type="button" className="quota-error" onClick={refreshCodexQuota}>
                {quotaError}
              </button>
            ) : null}
            {!quotaError && quotaNotice ? (
              <button type="button" className="quota-error" onClick={refreshCodexQuota}>
                {quotaNotice}，点击刷新
              </button>
            ) : null}
            {!quotaError && quotaAccounts.length ? (
              quotaAccounts.map((account) => {
                const windows = Array.isArray(account.windows) ? account.windows : [];
                const accountStatus = account.status || 'ok';
                const plan = account.plan || 'Codex';
                return (
                  <div key={account.id} className={`quota-account is-${accountStatus}`}>
                    <div className="quota-account-head">
                      <span>{account.label || 'Codex'}</span>
                      <small>{plan}</small>
                    </div>
                    {accountStatus === 'ok' && windows.length ? (
                      <div className="quota-window-list">
                        {windows.map((quotaWindow) => {
                          const percent = quotaRemainingPercent(quotaWindow);
                          return (
                            <div
                              key={quotaWindow.id}
                              className={`quota-window ${quotaToneClass(percent)}`}
                              style={{ '--quota-percent': `${percent ?? 0}%` }}
                            >
                              <div className="quota-window-meta">
                                <span>{quotaWindow.label}</span>
                                <strong>{formatQuotaPercent(quotaWindow)}</strong>
                              </div>
                              <div className="quota-bar">
                                <span />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="quota-account-message"
                        onClick={accountStatus === 'failed' ? refreshCodexQuota : undefined}
                      >
                        {accountStatus === 'disabled' ? '已停用' : `${account.error || '查询失败'}，点击刷新重试`}
                      </button>
                    )}
                  </div>
                );
              })
            ) : null}
            {!quotaLoading && !quotaError && quotaLoaded && !quotaAccounts.length ? (
              <div className="quota-empty">暂无 Codex 凭证</div>
            ) : null}
            {!quotaLoading && !quotaError && !quotaLoaded ? (
              <div className="quota-empty">点击右上角刷新查询额度</div>
            ) : null}
          </div>
        ) : null}

        <footer className="drawer-footer">
          <div className="drawer-footer-actions">
            <button
              type="button"
              className="footer-icon-button"
              onClick={() => setDrawerView('settings')}
              aria-label="设置"
            >
              <Settings size={16} />
            </button>
            <button
              type="button"
              className={`footer-icon-button ${syncing ? 'is-busy' : ''}`}
              onClick={onSync}
              disabled={syncing}
              aria-label="同步对话"
            >
              {syncing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            </button>
            <button
              type="button"
              className={`footer-icon-button ${quotaExpanded ? 'is-active' : ''}`}
              onClick={toggleQuotaPanel}
              aria-label="额度查询"
              aria-expanded={quotaExpanded}
            >
              <BarChart3 size={16} />
            </button>
          </div>
          <span className="drawer-footer-status">{statusText}</span>
        </footer>

        {threadActionMenu ? (
          <div className="thread-action-backdrop" onClick={() => setThreadActionMenu(null)}>
            <div
              className="thread-action-menu"
              role="menu"
              aria-label="线程操作"
              style={{
                '--thread-menu-x': `${threadActionMenu.x}px`,
                '--thread-menu-y': `${threadActionMenu.y}px`
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" role="menuitem" onClick={handleThreadRename}>
                <Pencil size={16} />
                <span>重命名</span>
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={handleThreadArchive}>
                <Archive size={16} />
                <span>归档</span>
              </button>
            </div>
          </div>
        ) : null}
        {renameDraft ? (
          <div className="thread-rename-backdrop" onClick={closeRenameDialog}>
            <form className="thread-rename-dialog" onSubmit={submitRenameDialog} onClick={(event) => event.stopPropagation()}>
              <div className="thread-rename-head">
                <strong>重命名线程</strong>
                <button type="button" className="thread-rename-icon" onClick={closeRenameDialog} aria-label="取消重命名">
                  <X size={16} />
                </button>
              </div>
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value.slice(0, 52))}
                placeholder="输入线程名称"
                aria-label="线程名称"
                maxLength={52}
              />
              <div className="thread-rename-actions">
                <button type="button" className="thread-rename-secondary" onClick={closeRenameDialog} disabled={renameSaving}>
                  取消
                </button>
                <button type="submit" className="thread-rename-primary" disabled={renameSaving || !renameValue.trim()}>
                  {renameSaving ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
                  <span>{renameSaving ? '保存中' : '保存'}</span>
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </aside>
    </>
  );
}
