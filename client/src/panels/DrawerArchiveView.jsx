/**
 * 归档箱抽屉子页：展示已归档线程并支持刷新与打开。
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

import { AlertCircle, Archive, ChevronLeft, Clock3, Folder, Inbox, MessageSquare, RefreshCw, X } from 'lucide-react';
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
  onOpenSession
}) {
  const archiveCount = archivedSessions.length;
  const archiveSyncLabel = archiveSyncedAt
    ? `${archiveSource === 'local' ? '本地兜底' : '桌面同步'} · ${formatTime(archiveSyncedAt)}`
    : '等待同步';

  return (
    <>
      <div className={`drawer-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} />
      <aside className={`drawer drawer-archive drawer-subpage ${open ? 'is-open' : ''}`}>
        <div className="drawer-subpage-header">
          <button className="icon-button" onClick={onBack} aria-label="返回设置">
            <ChevronLeft size={20} />
          </button>
          <strong>归档箱</strong>
          <button className="icon-button" onClick={onRefresh} disabled={archiveLoading} aria-label="刷新归档箱">
            <RefreshCw size={16} className={archiveLoading ? 'spin' : ''} />
          </button>
        </div>
        <div className="drawer-subpage-content archive-page">
          <section className="archive-overview" aria-label="归档概览">
            <div>
              <span className="subpage-eyebrow">Archive</span>
              <h2>{archiveCount ? `${archiveCount} 个已归档线程` : '已归档线程'}</h2>
            </div>
            <button type="button" className="archive-refresh-cta" onClick={onRefresh} disabled={archiveLoading}>
              <RefreshCw size={15} className={archiveLoading ? 'spin' : ''} />
              <span>刷新</span>
            </button>
            <div className="archive-meta-strip">
              <span>
                <Clock3 size={13} />
                {archiveSyncLabel}
              </span>
              <span>
                <Archive size={13} />
                只读
              </span>
            </div>
          </section>

          <section className="archive-list-panel" aria-label="归档线程列表">
            {archiveLoading && !archivedSessions.length ? (
              <div className="archive-empty-state">
                <RefreshCw size={18} className="spin" />
                <span>正在同步归档箱</span>
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
                <span>暂无已归档线程</span>
              </div>
            ) : null}
            {archivedSessions.length ? (
              <div className="archive-list">
                {archivedSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className="archive-thread-row"
                    onClick={() => onOpenSession(session)}
                  >
                    <span className="archive-thread-icon" aria-hidden="true">
                      <MessageSquare size={15} />
                    </span>
                    <span className="archive-thread-main">
                      <span className="archive-thread-title">{session.title || '对话'}</span>
                      {session.summary ? <span className="archive-thread-summary">{session.summary}</span> : null}
                      {session.projectPath ? (
                        <span className="archive-thread-project">
                          <Folder size={12} />
                          {compactPath(session.projectPath)}
                        </span>
                      ) : null}
                    </span>
                    <span className="archive-thread-time">
                      <Clock3 size={12} />
                      {session.archivedAt ? formatTime(session.archivedAt) : '已归档'}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
          <button type="button" className="archive-close-button" onClick={onClose}>
            <X size={15} />
            <span>关闭</span>
          </button>
        </div>
      </aside>
    </>
  );
}
