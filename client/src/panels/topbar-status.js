/**
 * 顶栏连接态文案：WebSocket / 桌面桥 / 选中会话与运行时的组合展示标签。
 *
 * Keywords: topbar, connection, bridge, runtime, websocket
 *
 * Exports:
 * - bridgeConnectionLabel — 返回 label、className、description。
 *
 * Inward: 无外部模块；纯函数根据连接与 runtime 派生文案。
 *
 * Outward: TopBar、topbar-status 单测、状态点展示。
 */

const CONNECTION_STATUS = {
  connected: { label: '已连接', className: 'is-connected', description: 'CodexMobile 服务已连接。' },
  connecting: { label: '连接中', className: 'is-connecting', description: '正在连接 CodexMobile 服务。' },
  disconnected: { label: '未连接', className: 'is-disconnected', description: 'CodexMobile 服务未连接。' }
};

function runtimeSource(runtime) {
  return String(runtime?.source || '').trim();
}

function isDesktopRuntime(runtime) {
  const source = runtimeSource(runtime);
  return source === 'desktop-ipc';
}

function isHeadlessRuntime(runtime) {
  const source = runtimeSource(runtime);
  return source === 'headless-local' || source === 'background' || source === 'local';
}

export function bridgeConnectionLabel(connectionState, desktopBridge, { selectedSession = null, selectedRuntime = null } = {}) {
  if (connectionState !== 'connected') {
    return CONNECTION_STATUS[connectionState] || CONNECTION_STATUS.disconnected;
  }

  if (selectedRuntime?.status === 'running') {
    if (isDesktopRuntime(selectedRuntime)) {
      return {
        label: '桌面运行中',
        className: 'is-connected is-thread-ipc',
        description: '当前线程正在桌面端接管窗口里执行。'
      };
    }
    if (isHeadlessRuntime(selectedRuntime)) {
      return {
        label: '后台运行中',
        className: 'is-connected is-headless',
        description: '当前线程正在后台 Codex 执行，桌面端没有接管这个运行。'
      };
    }
    return {
      label: '运行确认中',
      className: 'is-connected is-route-pending',
      description: '当前线程正在运行，正在确认这次执行来自桌面接管还是后台 Codex。'
    };
  }

  if (desktopBridge?.mode === 'headless-local') {
    return {
      label: '后台可用',
      className: 'is-connected is-headless',
      description: desktopBridge.reason || '桌面端不可用，发送会走后台 Codex。'
    };
  }

  if (desktopBridge?.mode === 'desktop-ipc') {
    return {
      label: selectedSession?.id ? '线程待确认' : '桌面在线',
      className: 'is-connected is-ipc-ready',
      description: selectedSession?.id
        ? '桌面 IPC 总线在线，但当前线程是否已被桌面接管要在发送时确认；若桌面未打开该线程会转后台执行。'
        : '桌面 IPC 总线在线；新对话会按当前能力选择桌面或后台路径。'
    };
  }

  return CONNECTION_STATUS.connected;
}
