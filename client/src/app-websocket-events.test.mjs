/**
 * 测试 app/useAppWebSocket.js：各类 WS 载荷是否应刷新线程或渲染本地消息。
 * Keywords: websocket, payload-guards, tests
 * Exports: 无导出 / 内含用例
 * Inward: app/useAppWebSocket.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldCompleteLocalTurnBeforeRefresh,
  shouldRefreshDesktopThreadForPayload,
  shouldRefreshCurrentSessionAfterReconnect,
  shouldRenderActivityMessageForPayload,
  shouldRenderAssistantMessageForPayload,
  shouldRenderStatusMessageForPayload
} from './app/useAppWebSocket.js';

test('desktop IPC status updates render through the same live path', () => {
  assert.equal(
    shouldRenderStatusMessageForPayload({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'running'
    }),
    false
  );
});

test('legacy status updates never render directly after sync rewrite', () => {
  assert.equal(
    shouldRenderStatusMessageForPayload({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'completed'
    }),
    false
  );
  assert.equal(
    shouldRenderStatusMessageForPayload({
      type: 'status-update',
      source: 'headless-local',
      kind: 'turn',
      status: 'running'
    }),
    false
  );
  assert.equal(
    shouldRenderStatusMessageForPayload({
      type: 'status-update',
      source: 'headless-local',
      kind: 'reasoning',
      status: 'running'
    }),
    false
  );
});

test('terminal events no longer trigger desktop-thread refresh path', () => {
  assert.equal(
    shouldRefreshDesktopThreadForPayload({
      type: 'chat-complete',
      source: 'desktop-ipc'
    }),
    false
  );
  assert.equal(
    shouldRefreshDesktopThreadForPayload({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'completed'
    }),
    false
  );
  assert.equal(
    shouldRefreshDesktopThreadForPayload({
      type: 'chat-complete',
      source: 'headless-local'
    }),
    false
  );
  assert.equal(
    shouldCompleteLocalTurnBeforeRefresh({
      type: 'chat-complete',
      source: 'desktop-ipc'
    }),
    false
  );
  assert.equal(
    shouldCompleteLocalTurnBeforeRefresh({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'completed'
    }),
    false
  );
  assert.equal(
    shouldCompleteLocalTurnBeforeRefresh({
      type: 'status-update',
      source: 'desktop-ipc',
      kind: 'turn',
      status: 'failed'
    }),
    false
  );
});

test('legacy activity and assistant updates no longer render directly', () => {
  assert.equal(
    shouldRenderActivityMessageForPayload({
      type: 'activity-update',
      source: 'headless-local',
      status: 'running'
    }),
    false
  );
  assert.equal(
    shouldRenderAssistantMessageForPayload({
      type: 'assistant-update',
      source: 'headless-local',
      content: '完成'
    }),
    false
  );
  assert.equal(
    shouldRenderActivityMessageForPayload({
      type: 'activity-update',
      status: 'running'
    }),
    false
  );
});

test('websocket reconnect refresh skips drafts and restores real selected sessions', () => {
  assert.equal(shouldRefreshCurrentSessionAfterReconnect({ id: 'thread-1' }), true);
  assert.equal(shouldRefreshCurrentSessionAfterReconnect({ id: 'draft-project-1' }), false);
  assert.equal(shouldRefreshCurrentSessionAfterReconnect(null), false);
});
