/**
 * 测试 panels/topbar-status.js：bridgeConnectionLabel 各连接与 runtime 组合。
 * Keywords: topbar, tests
 * Exports: 无导出 / 内含用例
 * Inward: panels/topbar-status.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeConnectionLabel } from './panels/topbar-status.js';

test('bridgeConnectionLabel shows connected as default idle label', () => {
  const label = bridgeConnectionLabel('connected', {
    selectedSession: { id: 'thread-1' }
  });

  assert.equal(label.label, '已连接');
});

test('bridgeConnectionLabel shows runtime channel instead of activity summary', () => {
  const headless = bridgeConnectionLabel('connected', {
    selectedSession: { id: 'thread-1' },
    selectedRuntime: { status: 'running', source: 'headless-local', label: '正在搜索文件' }
  });

  assert.equal(headless.label, '正在后台运行 Codex');
  assert.match(headless.className, /is-headless/);
});

test('bridgeConnectionLabel shows running label when runtime is active', () => {
  const label = bridgeConnectionLabel('connected', {
    selectedSession: { id: 'thread-1' },
    selectedRuntime: { status: 'running' }
  });

  assert.equal(label.label, '正在后台运行 Codex');
  assert.match(label.description, /等待 sync runtime/);
});

test('bridgeConnectionLabel switches queued and failure channel labels', () => {
  assert.equal(
    bridgeConnectionLabel('connected', {
      selectedRuntime: { status: 'queued', source: 'local-optimistic', label: '消息发送中' }
    }).label,
    '消息发送中'
  );
  assert.equal(
    bridgeConnectionLabel('connected', {
      selectedRuntime: { status: 'queued', source: 'headless-local' }
    }).label,
    '后台排队中'
  );
  assert.equal(
    bridgeConnectionLabel('connected', {
      selectedRuntime: { status: 'failed', source: 'headless-local', label: '工具调用失败' }
    }).label,
    '后台 Codex 运行失败'
  );
});

test('bridgeConnectionLabel falls back to idle label after completed runtime notice', () => {
  assert.equal(
    bridgeConnectionLabel('connected', {
      selectedSession: { id: 'thread-1' },
      selectedRuntime: { status: 'completed', source: 'headless-local' }
    }).label,
    '已连接'
  );
});

test('bridgeConnectionLabel uses compact disconnected label', () => {
  assert.equal(
    bridgeConnectionLabel('connected').label,
    '已连接'
  );

  assert.equal(
    bridgeConnectionLabel('disconnected').label,
    '未连接'
  );
});
