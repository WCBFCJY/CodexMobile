/**
 * 根据鉴权、连接态推导出连接恢复卡片的文案与主/次操作类型。
 *
 * Keywords: connection, recovery, pairing, syncing
 *
 * Exports:
 * - connectionRecoveryState — 返回 state、title、detail、primary/secondaryAction 等。
 *
 * Inward: 无。
 *
 * Outward: ConnectionRecoveryCard、全局连接 UX。
 */

export function connectionRecoveryState({
  authenticated = true,
  connectionState = 'connected',
  syncing = false
} = {}) {
  if (!authenticated) {
    return {
      state: 'pairing',
      title: '需要重新配对',
      detail: '当前设备授权失效，需要重新输入配对码。',
      primaryAction: 'pair',
      primaryLabel: '重新配对'
    };
  }

  if (connectionState === 'connecting') {
    return null;
  }

  if (connectionState === 'disconnected') {
    return {
      state: 'disconnected',
      title: '连接已断开',
      detail: '本机服务暂时不可达，可以重试或重新配对。',
      primaryAction: 'retry',
      primaryLabel: '重试连接',
      secondaryAction: 'pair',
      secondaryLabel: '重新配对'
    };
  }

  if (syncing) {
    return {
      state: 'syncing',
      title: '正在同步',
      detail: '正在刷新线程和本地缓存。',
      primaryAction: 'status',
      primaryLabel: '查看状态'
    };
  }

  return null;
}
