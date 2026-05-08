import assert from 'node:assert/strict';
import test from 'node:test';

import { nextSyncedComposerSettings } from './app/model-sync.js';

test('composer model follows desktop status changes while it is still synced', () => {
  const next = nextSyncedComposerSettings({
    currentModel: 'gpt-5.4',
    previousStatusModel: 'gpt-5.4',
    statusModel: 'gpt-5.2',
    currentReasoningEffort: 'high',
    previousStatusReasoningEffort: 'high',
    statusReasoningEffort: 'xhigh'
  });

  assert.deepEqual(next, {
    model: 'gpt-5.2',
    reasoningEffort: 'xhigh'
  });
});

test('composer model keeps an explicit mobile choice until desktop status catches up', () => {
  const next = nextSyncedComposerSettings({
    currentModel: 'gpt-5.3-codex',
    previousStatusModel: 'gpt-5.4',
    statusModel: 'gpt-5.4',
    currentReasoningEffort: 'high',
    previousStatusReasoningEffort: 'xhigh',
    statusReasoningEffort: 'xhigh'
  });

  assert.deepEqual(next, {
    model: 'gpt-5.3-codex',
    reasoningEffort: 'high'
  });
});
