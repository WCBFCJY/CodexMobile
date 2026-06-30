/**
 * 顶栏连接态文案：WebSocket / 选中会话与运行时的组合展示标签。
 *
 * Keywords: topbar, connection, runtime, websocket
 *
 * Exports:
 * - connectionStatusLabel — 返回 label、className、description。
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

const RUNTIME_STATUS = {
  queued: {
    label: '排队中',
    className: 'is-connected is-running is-headless',
    description: '已排队，等待执行。'
  },
  running: {
    label: '正在运行 Codex',
    className: 'is-connected is-running is-headless',
    description: '正在后台执行。'
  },
  failed: {
    label: 'Codex 运行失败',
    className: 'is-connected is-failed is-headless',
    description: '任务失败。'
  }
};

function runtimeLabelWithSource(runtime, status) {
  if (status === 'queued') {
    const source = String(runtime?.source || '').trim();
    if (source === 'local-optimistic') {
      return runtime?.label || '消息发送中';
    }
  }
  return RUNTIME_STATUS[status]?.label || RUNTIME_STATUS.running.label;
}

export function bridgeConnectionLabel(connectionState, { selectedRuntime = null } = {}) {
  if (connectionState !== 'connected') {
    return CONNECTION_STATUS[connectionState] || CONNECTION_STATUS.disconnected;
  }

  const runtimeStatus = String(selectedRuntime?.status || '').toLowerCase();
  if (runtimeStatus === 'queued' || runtimeStatus === 'running' || runtimeStatus === 'failed') {
    const base = RUNTIME_STATUS[runtimeStatus];
    const detail = String(selectedRuntime?.detail || '').trim();
    return {
      label: runtimeLabelWithSource(selectedRuntime, runtimeStatus),
      className: base.className,
      description: detail || base.description
    };
  }

  return CONNECTION_STATUS.connected;
}
