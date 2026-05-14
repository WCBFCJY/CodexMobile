/**
 * 测试 chat/chat-render-items.js：运行中过程投影与文件变更汇总。
 * Keywords: chat-render, process-stream, file-summary, tests
 * Exports: 无导出 / 内含用例
 * Inward: chat/chat-render-items.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatRenderItems,
  fileSummaryForActivityMessage,
  projectMessagesForActiveProcess
} from './chat/chat-render-items.js';

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

test('projectMessagesForActiveProcess renders one current process while a loaded half-card exists', () => {
  const messages = [
    { id: 'user-1', role: 'user', sessionId: 'thread-1', content: '跑任务' },
    {
      id: 'activity-loaded',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      turnId: 'desktop-turn-1',
      timestamp: '2026-05-14T03:40:01.000Z',
      activities: [
        { id: 'commentary-1', kind: 'agent_message', status: 'completed', label: '先查目录。' }
      ]
    },
    {
      id: 'activity-running',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      turnId: 'headless-turn-1',
      timestamp: '2026-05-14T03:40:20.000Z',
      activities: [
        { id: 'cmd-1', kind: 'command_execution', status: 'running', label: '正在运行命令' }
      ]
    }
  ];

  const projected = projectMessagesForActiveProcess(messages, 'activity-running');
  const activities = projected.filter((message) => message.role === 'activity');
  assert.equal(activities.length, 1);
  assert.equal(activities[0].id, 'activity-running');
  assert.equal(activities[0].status, 'running');
  assert.equal(activities[0].turnId, 'headless-turn-1');
  assert.deepEqual(
    activities[0].activities.map((activity) => activity.id),
    ['commentary-1', 'cmd-1']
  );
});

test('chatRenderItems hides the loaded half-card when active process is running', () => {
  const items = chatRenderItems([
    { id: 'user-1', role: 'user', sessionId: 'thread-1', content: '跑任务' },
    {
      id: 'activity-loaded',
      role: 'activity',
      status: 'completed',
      sessionId: 'thread-1',
      turnId: 'desktop-turn-1',
      timestamp: '2026-05-14T03:40:01.000Z',
      activities: [
        { id: 'commentary-1', kind: 'agent_message', status: 'completed', label: '先查目录。' }
      ]
    },
    {
      id: 'activity-running',
      role: 'activity',
      status: 'running',
      sessionId: 'thread-1',
      turnId: 'headless-turn-1',
      timestamp: '2026-05-14T03:40:20.000Z',
      activities: [
        { id: 'cmd-1', kind: 'command_execution', status: 'running', label: '正在运行命令' }
      ]
    }
  ], { activeActivityMessageId: 'activity-running' });

  assert.deepEqual(items.map((item) => [item.type, item.message?.id]), [
    ['message', 'user-1'],
    ['message', 'activity-running']
  ]);
  assert.equal(items[1].message.status, 'running');
});
