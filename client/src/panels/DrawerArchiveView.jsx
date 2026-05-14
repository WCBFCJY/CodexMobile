/**
 * 归档箱抽屉子页：以桌面端列表风格展示已归档线程，并提供只读查看与取消归档。
 *
 * Keywords: drawer, archive, sessions, settings, desktop-sync
 *
 * Exports:
 * - DrawerArchiveView — 归档箱视图组件。
 *
 * Inward: session-utils（时间与路径展示）；lucide-react。
 *
 * Outward: Drawer 在 archive 子视图中渲染。
 */

import { AlertCircle, ChevronLeft, Clock3, Folder, Inbox, MessageSquare, RefreshCw } from 'lucide-react';
import { compactPath, formatTime } from '../app/session-utils.js';

export function DrawerArchiveView({
  open,
  onClose,
  onBack,
  onRefresh,
  archivedSessions,
  archiveLoading,
  archiveLoaded,
  archiveError,
  archiveSyncedAt,
  archiveSource,
  onOpenSession,
  onUnarchiveSession,
  unarchivingSessionIds = {}
}) {
  const archiveCount = archivedSessions.length;
  const archiveSyncLabel = archiveSyncedAt
    ? `${archiveSource === 'local' ? '本地兜底' : '桌面同步'} · ${formatTime(archiveSyncedAt)}`
    : '等待同步';

  return (
    <>
      <div className={`drawer-backdrop drawer-subpage-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} />
      <aside className={`drawer drawer-archive drawer-subpage ${open ? 'is-open' : ''}`}>
        <div className="drawer-subpage-header">
          <button className="icon-button" onClick={onBack} aria-label="返回设置">
            <ChevronLeft size={20} />
          </button>
          <strong>已归档对话</strong>
          <span className="drawer-subpage-header-spacer" aria-hidden="true" />
        </div>

        <div className="drawer-subpage-content archive-page">
          <section className="archive-toolbar" aria-label="归档概览">
            <div>
              <h2>已归档对话</h2>
              <p>{archiveCount ? `${archiveCount} 个对话` : '暂无对话'} · {archiveSyncLabel}</p>
            </div>
            <button type="button" className="archive-refresh-cta" onClick={onRefresh} disabled={archiveLoading} aria-label="刷新归档对话">
              <RefreshCw size={15} className={archiveLoading ? 'spin' : ''} />
              <span>刷新</span>
            </button>
          </section>

          <section className="archive-list-panel" aria-label="归档线程列表">
            {archiveLoading && !archivedSessions.length ? (
              <div className="archive-empty-state">
                <RefreshCw size={18} className="spin" />
                <span>正在同步归档对话</span>
              </div>
            ) : null}
            {archiveError ? (
              <button type="button" className="archive-empty-state archive-error" onClick={onRefresh}>
                <AlertCircle size={18} />
                <span>同步失败，点击重试</span>
              </button>
            ) : null}
            {!archiveLoading && !archiveError && archiveLoaded && !archivedSessions.length ? (
              <div className="archive-empty-state">
                <Inbox size={18} />
                <span>暂无已归档对话</span>
              </div>
            ) : null}
            {archivedSessions.length ? (
              <div className="archive-list">
                {archivedSessions.map((session) => {
                  const unarchiving = Boolean(unarchivingSessionIds[session.id]);
                  return (
                    <div key={session.id} className="archive-thread-row">
                      <button
                        type="button"
                        className="archive-thread-open"
                        onClick={() => onOpenSession(session)}
                      >
                        <span className="archive-thread-main">
                          <span className="archive-thread-title">
                            <MessageSquare size={13} />
                            <span>{session.title || '对话'}</span>
                          </span>
                          {session.summary ? <span className="archive-thread-summary">{session.summary}</span> : null}
                          <span className="archive-thread-meta">
                            <Clock3 size={12} />
                            <span>{session.archivedAt ? formatTime(session.archivedAt) : '已归档'}</span>
                            {session.projectPath ? (
                              <>
                                <span className="archive-meta-dot" aria-hidden="true" />
                                <Folder size={12} />
                                <span className="archive-thread-project">{compactPath(session.projectPath)}</span>
                              </>
                            ) : null}
                          </span>
                        </span>
                        {session.projectPath ? (
                          <span className="archive-thread-project-wide">
                            <Folder size={12} />
                            {compactPath(session.projectPath)}
                          </span>
                        ) : null}
                        <span className="archive-thread-time">
                          <Clock3 size={12} />
                          {session.archivedAt ? formatTime(session.archivedAt) : '已归档'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="archive-unarchive-button"
                        onClick={() => onUnarchiveSession?.(session)}
                        disabled={unarchiving}
                        aria-label={`取消归档 ${session.title || '对话'}`}
                      >
                        {unarchiving ? <RefreshCw size={14} className="spin" /> : null}
                        <span>{unarchiving ? '恢复中' : '取消归档'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        </div>
      </aside>
    </>
  );
}
