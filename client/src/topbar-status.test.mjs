/**
 * 测试 panels/topbar-status.js：bridgeConnectionLabel 各连接与 runtime 组合。
 * Keywords: topbar, bridge, tests
 * Exports: 无导出 / 内含用例
 * Inward: panels/topbar-status.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeConnectionLabel } from './panels/topbar-status.js';

test('bridgeConnectionLabel shows idle desktop IPC as mirror-only sync', () => {
  const label = bridgeConnectionLabel('connected', {
    connected: true,
    mode: 'desktop-ipc'
  }, {
    selectedSession: { id: 'thread-1' }
  });

  assert.equal(label.label, '桌面同步');
  assert.match(label.description, /移动端发送固定走后台 Codex/);
});

test('bridgeConnectionLabel distinguishes desktop and background running routes', () => {
  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
      selectedSession: { id: 'thread-1' },
      selectedRuntime: { status: 'running', source: 'desktop-ipc' }
    }).label,
    '桌面镜像中'
  );

  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
      selectedSession: { id: 'thread-1' },
      selectedRuntime: { status: 'running', source: 'headless-local' }
    }).label,
    '后台运行中'
  );
});

test('bridgeConnectionLabel avoids claiming IPC route before running source is known', () => {
  const label = bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
    selectedSession: { id: 'thread-1' },
    selectedRuntime: { status: 'running' }
  });

  assert.equal(label.label, '运行确认中');
  assert.match(label.description, /等待 sync runtime/);
});

test('bridgeConnectionLabel uses compact background and disconnected labels', () => {
  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'headless-local' }).label,
    '后台可用'
  );

  assert.equal(
    bridgeConnectionLabel('disconnected', null).label,
    '未连接'
  );
});
