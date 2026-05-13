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
        label: '桌面镜像中',
        className: 'is-connected is-thread-ipc',
        description: '当前线程来自桌面端 live mirror，移动端只同步桌面运行过程。'
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
      description: '当前线程正在运行，正在等待 sync runtime 标明来源。'
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
      label: selectedSession?.id ? '桌面同步' : '桌面在线',
      className: 'is-connected is-ipc-ready',
      description: selectedSession?.id
        ? '桌面 IPC 总线在线，用于 live mirror、线程刷新、重命名和模型观察；移动端发送固定走后台 Codex。'
        : '桌面 IPC 总线在线，用于同步桌面会话；移动端发送固定走后台 Codex。'
    };
  }

  return CONNECTION_STATUS.connected;
}
