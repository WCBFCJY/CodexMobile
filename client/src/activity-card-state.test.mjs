/**
 * 测试 chat/activity-card-state.js：活动卡片是否在可见进程运行时应展开。
 * Keywords: activity-card, tests
 * Exports: 无导出 / 内含用例
 * Inward: chat/activity-card-state.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityCardShouldOpen,
  activityMessageIsRunning,
  effectiveActivityMessageIsRunning
} from './chat/activity-card-state.js';

test('activity card opens only while a visible process is running', () => {
  assert.equal(activityCardShouldOpen({ running: true, hasProcess: true }), true);
  assert.equal(activityCardShouldOpen({ running: false, hasProcess: true }), false);
  assert.equal(activityCardShouldOpen({ running: true, hasProcess: false }), false);
});

test('activity card treats running child steps as an active desktop process', () => {
  const message = {
    status: 'completed',
    activities: [
      { id: 'search', status: 'completed' },
      { id: 'command', status: 'running' }
    ]
  };

  assert.equal(activityMessageIsRunning(message), true);
  assert.equal(activityCardShouldOpen({ message, hasProcess: true }), true);
});

test('activity card can follow external runtime while desktop projection is stale completed', () => {
  const message = {
    status: 'completed',
    activities: [
      { id: 'command', status: 'completed' }
    ]
  };

  assert.equal(activityMessageIsRunning(message), false);
  assert.equal(effectiveActivityMessageIsRunning({ message, forceRunning: true }), true);
  assert.equal(activityCardShouldOpen({ running: true, hasProcess: true }), true);
});
