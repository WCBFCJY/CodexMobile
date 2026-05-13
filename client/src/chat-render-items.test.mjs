/**
 * 测试 chat/chat-render-items.js：文件变更卡片应挂到同轮助手结果下方。
 * Keywords: chat-render, file-summary, tests
 * Exports: 无导出 / 内含用例
 * Inward: chat/chat-render-items.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chatRenderItems, fileSummaryForActivityMessage } from './chat/chat-render-items.js';

const fileChangeActivity = {
  id: 'activity-1',
  role: 'activity',
  turnId: 'turn-1',
  status: 'completed',
  activities: [
    {
      id: 'patch-1',
      kind: 'file_change',
      status: 'completed',
      fileChanges: [
        {
          path: 'client/src/chat/ActivityMessage.jsx',
          kind: 'update',
          additions: 2,
          deletions: 1,
          unifiedDiff: '@@\n-old\n+new\n+again'
        }
      ]
    }
  ]
};

test('chatRenderItems attaches completed file summary below the assistant result', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', turnId: 'turn-1', content: '修一下' },
    fileChangeActivity,
    { id: 'answer-1', role: 'assistant', turnId: 'turn-1', content: '改好了' }
  ]);

  assert.deepEqual(items.map((item) => [item.type, item.message?.role || 'fileSummary']), [
    ['message', 'user'],
    ['message', 'activity'],
    ['message', 'assistant']
  ]);
  assert.equal(items[2].fileSummaries.length, 1);
  assert.equal(items[2].fileSummaries[0].files[0].path, 'client/src/chat/ActivityMessage.jsx');
});

test('chatRenderItems waits for the assistant result before showing a file summary', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', turnId: 'turn-1', content: '修一下' },
    fileChangeActivity
  ]);

  assert.deepEqual(items.map((item) => item.type), ['message', 'message']);
});

test('fileSummaryForActivityMessage hides file cards while the activity is still running', () => {
  assert.equal(fileSummaryForActivityMessage({
    ...fileChangeActivity,
    status: 'running'
  }), null);
});
