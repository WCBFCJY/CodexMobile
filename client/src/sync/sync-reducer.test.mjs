/**
 * 测试 client/src/sync/sync-reducer.js：统一同步事件对前端 runtime map 的影响。
 *
 * Keywords: sync-reducer, runtime, terminal
 *
 * Exports: 无导出 / 内含用例。
 *
 * Inward: client/src/sync/sync-reducer.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySyncRuntimeEvent,
  mergeSyncStateRuntime,
  sessionMatchesSyncEvent,
  syncEventRunKeys
} from './sync-reducer.js';

test('completed turn clears every runtime key for a mobile submitted turn', () => {
  const running = applySyncRuntimeEvent({}, {
    eventType: 'turn.running',
    source: 'desktop-ipc',
    sessionId: 'session-1',
    turnId: 'desktop-turn',
    clientTurnId: 'mobile-turn',
    timestamp: '2026-05-13T01:00:00.000Z'
  });
  assert.equal(running['session-1'].status, 'running');
  assert.equal(running['mobile-turn'].source, 'desktop-ipc');

  const completed = applySyncRuntimeEvent(running, {
    eventType: 'turn.completed',
    source: 'desktop-ipc',
    sessionId: 'session-1',
    turnId: 'desktop-turn',
    clientTurnId: 'mobile-turn',
    timestamp: '2026-05-13T01:01:00.000Z'
  });
  assert.deepEqual(completed, {});
});

test('sync-state replaces stale sync-owned runtime and removes local handoff runtime', () => {
  const next = mergeSyncStateRuntime(
    {
      stale: { status: 'running', source: 'desktop-ipc' },
      local: { status: 'running', source: 'local-handoff' }
    },
    {
      runtimeById: {
        fresh: { status: 'running', source: 'headless-local' }
      }
    }
  );
  assert.equal(next.stale, undefined);
  assert.equal(next.local, undefined);
  assert.equal(next.fresh.source, 'headless-local');
});

test('session matching accepts session, turn, client turn, previous, and draft ids', () => {
  const event = {
    eventType: 'turn.running',
    sessionId: 'session-1',
    turnId: 'turn-1',
    clientTurnId: 'client-1',
    previousSessionId: 'previous-1',
    draftSessionId: 'draft-1'
  };
  assert.deepEqual(syncEventRunKeys(event), ['turn-1', 'client-1', 'session-1', 'previous-1', 'draft-1']);
  assert.equal(sessionMatchesSyncEvent({ id: 'session-1' }, event), true);
  assert.equal(sessionMatchesSyncEvent({ turnId: 'client-1' }, event), true);
  assert.equal(sessionMatchesSyncEvent({ id: 'other' }, event), false);
});
