/**
 * 测试 server/codex-config.js：模型设置写入 config.toml 根级字段。
 * Keywords: codex-config, model-settings, toml, tests
 * Exports: 无导出 / 内含用例
 * Inward: codex-config.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  modelSettingsKey,
  updateRootTomlAssignments
} from './codex-config.js';

test('updateRootTomlAssignments replaces root model settings without touching project tables', () => {
  const raw = [
    'model = "gpt-5.4"',
    'model_reasoning_effort = "medium"',
    '',
    '[projects."/repo"]',
    'model = "should-not-change"'
  ].join('\n');

  assert.equal(
    updateRootTomlAssignments(raw, {
      model: 'gpt-5.5',
      model_reasoning_effort: 'high'
    }),
    [
      'model = "gpt-5.5"',
      'model_reasoning_effort = "high"',
      '',
      '[projects."/repo"]',
      'model = "should-not-change"'
    ].join('\n')
  );
});

test('updateRootTomlAssignments inserts missing settings before the first table', () => {
  assert.equal(
    updateRootTomlAssignments('[projects."/repo"]\ntrust_level = "trusted"\n', {
      model: 'gpt-5.5',
      model_reasoning_effort: 'xhigh'
    }),
    [
      'model = "gpt-5.5"',
      'model_reasoning_effort = "xhigh"',
      '',
      '[projects."/repo"]',
      'trust_level = "trusted"',
      ''
    ].join('\n')
  );
});

test('modelSettingsKey scopes thread-specific settings by session id', () => {
  assert.notEqual(
    modelSettingsKey({
      provider: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      sessionId: 'thread-a'
    }),
    modelSettingsKey({
      provider: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      sessionId: 'thread-b'
    })
  );
});
