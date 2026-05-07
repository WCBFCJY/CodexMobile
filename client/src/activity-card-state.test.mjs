import assert from 'node:assert/strict';
import test from 'node:test';
import { activityCardShouldOpen } from './chat/activity-card-state.js';

test('activity card opens only while a visible process is running', () => {
  assert.equal(activityCardShouldOpen({ running: true, hasProcess: true }), true);
  assert.equal(activityCardShouldOpen({ running: false, hasProcess: true }), false);
  assert.equal(activityCardShouldOpen({ running: true, hasProcess: false }), false);
});
