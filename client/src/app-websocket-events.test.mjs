/**
 * 测试 app/useAppWebSocket.js：重连后刷新逻辑守卫。
 * Keywords: websocket, reconnect, tests
 * Exports: 无导出 / 内含用例
 * Inward: app/useAppWebSocket.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldRefreshCurrentSessionAfterReconnect
} from './app/useAppWebSocket.js';

test('websocket reconnect refresh skips drafts and restores real selected sessions', () => {
  assert.equal(shouldRefreshCurrentSessionAfterReconnect({ id: 'thread-1' }), true);
  assert.equal(shouldRefreshCurrentSessionAfterReconnect({ id: 'draft-project-1' }), false);
  assert.equal(shouldRefreshCurrentSessionAfterReconnect(null), false);
});
