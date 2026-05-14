/**
 * 设置抽屉子页：主题、归档入口、诊断开关与版本号展示。
 *
 * Keywords: drawer, settings, theme, diagnostics, archive-box
 *
 * Exports:
 * - DrawerSettingsView — 设置页视图组件。
 *
 * Inward: lucide-react；父级 Drawer 注入状态与事件。
 *
 * Outward: Drawer 在 settings 子视图中渲染。
 */

import { Archive, Bug, ChevronLeft, ChevronRight, Info, MonitorCog, Moon, Sun, X } from 'lucide-react';

export function DrawerSettingsView({
  open,
  onClose,
  onBack,
  theme,
  setTheme,
  onOpenArchiveBox,
  runtimeDebug,
  runtimeDebugSaving,
  runtimeDebugError,
  onRuntimeDebugToggle,
  desktopRefresh,
  desktopRefreshSaving,
  desktopRefreshError,
  onDesktopRefreshToggle,
  appVersion
}) {
  const runtimeDebugText = runtimeDebug?.envEnabled
    ? '环境变量已启用'
    : runtimeDebug?.uiEnabled
      ? '已开启'
      : '未开启';
  const desktopRefreshText = !desktopRefresh?.supported
    ? '当前不可用'
    : desktopRefresh?.enabled
      ? '已开启'
      : '未开启';

  return (
    <>
      <div className={`drawer-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} />
      <aside className={`drawer drawer-settings drawer-subpage ${open ? 'is-open' : ''}`}>
        <div className="drawer-subpage-header">
          <button className="icon-button" onClick={onBack} aria-label="返回">
            <ChevronLeft size={20} />
          </button>
          <strong>设置</strong>
          <button className="icon-button" onClick={onClose} aria-label="关闭菜单">
            <X size={20} />
          </button>
        </div>
        <div className="drawer-subpage-content settings-view">
          <section className="settings-overview" aria-label="设置概览">
            <div>
              <span className="subpage-eyebrow">CodexMobile</span>
              <h2>偏好与维护</h2>
            </div>
            <span className="settings-version-chip">v{appVersion}</span>
          </section>

          <section className="settings-section-card" aria-labelledby="appearance-title">
            <h3 id="appearance-title" className="drawer-section-title">外观</h3>
            <div className="settings-list">
              <div className="settings-row is-stacked">
                <div className="settings-row-main">
                  <span className="settings-row-icon" aria-hidden="true">
                    {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                  </span>
                  <div>
                    <span className="settings-row-title">主题</span>
                    <small>{theme === 'system' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色'}</small>
                  </div>
                </div>
                <div className="settings-segmented-control" role="group" aria-label="主题选择">
                  <button
                    type="button"
                    className={theme === 'light' ? 'is-selected' : ''}
                    onClick={() => setTheme('light')}
                  >
                    浅色
                  </button>
                  <button
                    type="button"
                    className={theme === 'dark' ? 'is-selected' : ''}
                    onClick={() => setTheme('dark')}
                  >
                    深色
                  </button>
                  <button
                    type="button"
                    className={theme === 'system' ? 'is-selected' : ''}
                    onClick={() => setTheme('system')}
                  >
                    系统
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section-card" aria-labelledby="conversation-title">
            <h3 id="conversation-title" className="drawer-section-title">会话</h3>
            <div className="settings-list">
              <button type="button" className="settings-row is-actionable" onClick={onOpenArchiveBox}>
                <div className="settings-row-main">
                  <span className="settings-row-icon" aria-hidden="true">
                    <Archive size={16} />
                  </span>
                  <div>
                    <span className="settings-row-title">归档箱</span>
                    <small>已归档线程</small>
                  </div>
                </div>
                <ChevronRight size={16} className="settings-row-arrow" />
              </button>
            </div>
          </section>

          <section className="settings-section-card" aria-labelledby="diagnostics-title">
            <h3 id="diagnostics-title" className="drawer-section-title">开发与排查</h3>
            <div className="settings-list">
              <label className="settings-row">
                <div className="settings-row-main">
                  <span className="settings-row-icon" aria-hidden="true">
                    <Bug size={16} />
                  </span>
                  <div>
                    <span className="settings-row-title">运行态调试日志</span>
                    <small>{runtimeDebugText}</small>
                  </div>
                </div>
                <div className="settings-switch">
                  <input
                    type="checkbox"
                    className="settings-switch-input"
                    checked={Boolean(runtimeDebug?.uiEnabled)}
                    disabled={runtimeDebugSaving}
                    onChange={onRuntimeDebugToggle}
                  />
                  <span className="settings-switch-slider" aria-hidden="true" />
                </div>
              </label>
              <div className="settings-row-note">
                <Info size={13} />
                <span>
                  {runtimeDebug?.logRelativePath || '.codexmobile/logs/runtime-debug.jsonl'}
                  {runtimeDebug?.envEnabled ? ' 已通过环境变量启用。' : ''}
                  {runtimeDebugError ? <em> {runtimeDebugError}</em> : null}
                </span>
              </div>

              <label className="settings-row">
                <div className="settings-row-main">
                  <span className="settings-row-icon" aria-hidden="true">
                    <MonitorCog size={16} />
                  </span>
                  <div>
                    <span className="settings-row-title">桌面自动刷新</span>
                    <small>{desktopRefreshText}</small>
                  </div>
                </div>
                <div className="settings-switch">
                  <input
                    type="checkbox"
                    className="settings-switch-input"
                    checked={Boolean(desktopRefresh?.enabled)}
                    disabled={desktopRefreshSaving || !desktopRefresh?.supported}
                    onChange={onDesktopRefreshToggle}
                  />
                  <span className="settings-switch-slider" aria-hidden="true" />
                </div>
              </label>
              {desktopRefresh?.lastError || desktopRefreshError ? (
                <div className="settings-row-note is-error">
                  <Info size={13} />
                  <span>{desktopRefreshError || desktopRefresh.lastError}</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
