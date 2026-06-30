/**
 * 测试 connection-recovery.js：连接恢复卡片状态机映射。
 * Keywords: connection-recovery, tests
 * Exports: 无导出 / 内含用例
 * Inward: connection-recovery.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionRecoveryState } from './connection-recovery.js';

test('connectionRecoveryState maps connection states to recovery cards', () => {
  assert.equal(connectionRecoveryState({ authenticated: false }).state, 'pairing');
  assert.equal(connectionRecoveryState({ connectionState: 'connecting' }).state, 'reconnecting');
  assert.equal(connectionRecoveryState({ connectionState: 'disconnected' }).state, 'disconnected');
  assert.equal(connectionRecoveryState({ syncing: true }).state, 'syncing');
  assert.deepEqual(
    connectionRecoveryState({
      syncing: true,
      connectionState: 'connected'
    }),
    { state: 'syncing', title: '正在同步', detail: '正在刷新线程和本地缓存。', primaryAction: 'status', primaryLabel: '查看状态' }
  );
});

test('connectionRecoveryState returns null when connected and healthy', () => {
  assert.deepEqual(
    connectionRecoveryState({
      connectionState: 'connected'
    }),
    null
  );
});
