/**
 * 测试 sync/useSyncSocket.js：统一同步事件如何确认本地 pending 用户消息。
 * Keywords: sync-socket, user-message, pending, dedupe, tests
 * Exports: 无导出 / 内含用例
 * Inward: sync/useSyncSocket.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applySyncSocketPayload } from './sync/useSyncSocket.js';

function applyWithMessages(messages, event) {
  let nextMessages = messages;
  const handled = applySyncSocketPayload({
    type: 'sync-event',
    event
  }, {
    selectedSessionRef: { current: { id: event.sessionId, turnId: event.clientTurnId } },
    setMessages(update) {
      nextMessages = update(nextMessages);
    }
  });
  return { handled, messages: nextMessages };
}

test('message.user confirms only the matching pending duplicate content message', () => {
  const current = [
    {
      id: 'old-user',
      role: 'user',
      content: '继续',
      sessionId: 'thread-1',
      turnId: 'old-turn',
      deliveryState: 'confirmed',
      timestamp: '2026-05-13T00:00:00.000Z'
    },
    {
      id: 'local-user',
      role: 'user',
      content: '继续',
      sessionId: 'thread-1',
      turnId: 'client-turn-2',
      deliveryState: 'pending',
      timestamp: '2026-05-13T00:01:00.000Z'
    }
  ];

  const result = applyWithMessages(current, {
    eventType: 'message.user',
    sessionId: 'thread-1',
    turnId: 'real-turn-2',
    clientTurnId: 'client-turn-2',
    message: {
      id: 'server-user',
      role: 'user',
      content: '继续',
      timestamp: '2026-05-13T00:01:01.000Z'
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].turnId, 'old-turn');
  assert.equal(result.messages[0].deliveryState, 'confirmed');
  assert.equal(result.messages[1].turnId, 'real-turn-2');
  assert.equal(result.messages[1].deliveryState, 'confirmed');
});
