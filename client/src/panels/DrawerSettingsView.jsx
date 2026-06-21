/**
 * 设置抽屉子页：主题、归档、安全设备、诊断开关与版本号展示。
 *
 * Keywords: drawer, settings, theme, diagnostics, archive-box, security-devices
 *
 * Exports:
 * - DrawerSettingsView — 设置页视图组件。
 *
 * Inward: lucide-react、api、security-devices；父级 Drawer 注入状态与事件。
 *
 * Outward: Drawer 在 settings 子视图中渲染。
 */

import { Archive, Bug, ChevronLeft, ChevronRight, Info, LogOut, MonitorCog, Moon, RefreshCw, ShieldCheck, Smartphone, Sun, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { deviceMetaText, deviceStatusText, sortDevicesForDisplay } from '../security-devices.js';

export function DrawerSettingsView({
  open,
  onClose,
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
  onLoggedOut,
  appVersion
}) {
  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState('');
  const sortedDevices = sortDevicesForDisplay(devices);

  async function loadDevices() {
    setDevicesLoading(true);
    setDevicesError('');
    try {
      const data = await apiFetch('/api/devices');
      setDevices(Array.isArray(data.devices) ? data.devices : []);
    } catch (error) {
      setDevicesError(error.message || '设备列表读取失败');
    } finally {
      setDevicesLoading(false);
    }
  }

  async function handleLogout() {
    setDevicesLoading(true);
    try {
      await apiFetch('/api/logout', { method: 'POST' });
      onLoggedOut?.();
    } catch (error) {
      setDevicesError(error.message || '退出失败');
    } finally {
      setDevicesLoading(false);
    }
  }

  async function handleDeleteDevice(deviceId) {
    setDevicesLoading(true);
    setDevicesError('');
    try {
      await apiFetch(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
      await loadDevices();
    } catch (error) {
      setDevicesError(error.message || '删除设备失败');
      setDevicesLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      loadDevices();
    }
  }, [open]);

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
      <div className={`drawer-backdrop drawer-subpage-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} />
      <aside className={`drawer drawer-settings drawer-subpage ${open ? 'is-open' : ''}`}>
        <div className="drawer-subpage-header">
          <button className="icon-button" onClick={onBack} aria-label="返回">
            <ChevronLeft size={20} />
          </button>
          <strong>设置</strong>
          <div className="drawer-subpage-actions">
            <span className="settings-version-text">v{appVersion}</span>
          </div>
        </div>
        <div className="drawer-subpage-content settings-view">
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

          <section className="settings-section-card" aria-labelledby="security-title">
            <h3 id="security-title" className="drawer-section-title">安全与设备</h3>
            <div className="settings-list">
              <div className="settings-row">
                <div className="settings-row-main">
                  <span className="settings-row-icon" aria-hidden="true">
                    <ShieldCheck size={16} />
                  </span>
                  <div>
                    <span className="settings-row-title">可信设备</span>
                    <small>{devicesLoading ? '正在刷新' : `${sortedDevices.length} 台设备`}</small>
                  </div>
                </div>
                <button type="button" className="icon-button" onClick={loadDevices} disabled={devicesLoading} aria-label="刷新设备">
                  <RefreshCw size={16} className={devicesLoading ? 'spin' : ''} />
                </button>
              </div>
              {devicesError ? (
                <div className="settings-row-note is-error">
                  <Info size={13} />
                  <span>{devicesError}</span>
                </div>
              ) : null}
              {sortedDevices.map((device) => (
                <div key={device.id} className="settings-row">
                  <div className="settings-row-main">
                    <span className="settings-row-icon" aria-hidden="true">
                      <Smartphone size={16} />
                    </span>
                    <div>
                      <span className="settings-row-title">{device.name || '未命名设备'}</span>
                      <small>{deviceStatusText(device)} · {deviceMetaText(device)}</small>
                    </div>
                  </div>
                  {!device.current ? (
                    <button type="button" className="icon-button" onClick={() => handleDeleteDevice(device.id)} disabled={devicesLoading} aria-label="删除设备">
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>
              ))}
              <button type="button" className="settings-row is-actionable" onClick={handleLogout} disabled={devicesLoading}>
                <div className="settings-row-main">
                  <span className="settings-row-icon" aria-hidden="true">
                    <LogOut size={16} />
                  </span>
                  <div>
                    <span className="settings-row-title">退出当前设备</span>
                    <small>清除本机信任状态并回到配对页</small>
                  </div>
                </div>
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
