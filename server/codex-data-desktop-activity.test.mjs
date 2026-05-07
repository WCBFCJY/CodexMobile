import assert from 'node:assert/strict';
import test from 'node:test';
import { messagesFromDesktopThread, rawSessionActivitiesFromJsonl } from './codex-data.js';

test('messagesFromDesktopThread preserves running desktop file activity', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'running',
        startedAt: 1770000000,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '修一下 UI' }] },
          {
            id: 'file-1',
            type: 'fileChange',
            status: 'running',
            changes: [{ path: '/tmp/App.jsx', kind: 'update', unified_diff: '+ok\n' }]
          }
        ]
      }
    ]
  }, { includeActivity: true });

  const activityMessage = messages.find((message) => message.role === 'activity');
  assert.equal(activityMessage.status, 'running');
  assert.equal(activityMessage.activities[0].kind, 'file_change');
  assert.equal(activityMessage.activities[0].status, 'running');
  assert.equal(activityMessage.activities[0].label, '正在更新文件');
});

test('messagesFromDesktopThread uses mobile labels for completed desktop command activity', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '跑测试' }] },
          {
            id: 'cmd-1',
            type: 'commandExecution',
            status: 'completed',
            command: 'npm test',
            aggregatedOutput: 'ok'
          },
          { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '测试通过' }
        ]
      }
    ]
  }, { includeActivity: true });

  const activityMessage = messages.find((message) => message.role === 'activity');
  assert.equal(activityMessage.status, 'completed');
  assert.equal(activityMessage.activities[0].kind, 'command_execution');
  assert.equal(activityMessage.activities[0].status, 'completed');
  assert.equal(activityMessage.activities[0].label, '本地任务已处理');
});

test('rawSessionActivitiesFromJsonl restores exec_command events omitted by desktop thread read', () => {
  const content = [
    {
      timestamp: '2026-02-02T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-1',
        arguments: JSON.stringify({ cmd: 'rg foo client/src' })
      }
    },
    {
      timestamp: '2026-02-02T00:00:01.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Chunk ID: abc\nWall time: 0.0000 seconds\nProcess exited with code 0\nOutput:\nclient/src/App.jsx:foo'
      }
    }
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const activities = rawSessionActivitiesFromJsonl(content, [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:03.000Z') / 1000
    }
  ]);

  assert.equal(activities.length, 1);
  assert.equal(activities[0].turnId, 'turn-1');
  assert.equal(activities[0].activity.kind, 'command_execution');
  assert.equal(activities[0].activity.status, 'completed');
  assert.equal(activities[0].activity.command, 'rg foo client/src');
  assert.equal(activities[0].activity.output, 'client/src/App.jsx:foo');
});

test('rawSessionActivitiesFromJsonl expands parallel exec_command calls', () => {
  const content = JSON.stringify({
    timestamp: '2026-02-02T00:00:01.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'parallel',
      call_id: 'call-parallel',
      arguments: JSON.stringify({
        tool_uses: [
          {
            recipient_name: 'functions.exec_command',
            parameters: { cmd: 'git status --short' }
          },
          {
            recipient_name: 'functions.exec_command',
            parameters: { cmd: 'npm run build' }
          }
        ]
      })
    }
  });

  const activities = rawSessionActivitiesFromJsonl(content, [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:03.000Z') / 1000
    }
  ]);

  assert.deepEqual(
    activities.map((item) => item.activity.command),
    ['git status --short', 'npm run build']
  );
});

test('rawSessionActivitiesFromJsonl preserves commentary and tool order', () => {
  const turnWindow = [
    {
      id: 'turn-1',
      startedAt: Date.parse('2026-02-02T00:00:00.000Z') / 1000,
      completedAt: Date.parse('2026-02-02T00:00:10.000Z') / 1000
    }
  ];
  const content = [
    {
      timestamp: '2026-02-02T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: '先看状态。' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-1',
        arguments: JSON.stringify({ cmd: 'git status --short' })
      }
    },
    {
      timestamp: '2026-02-02T00:00:02.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Process exited with code 0\nOutput:\n M file.js'
      }
    },
    {
      timestamp: '2026-02-02T00:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: '再看页面。' }]
      }
    },
    {
      timestamp: '2026-02-02T00:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        namespace: 'mcp__playwright__',
        name: 'browser_snapshot',
        call_id: 'call-2',
        arguments: '{}'
      }
    },
    {
      timestamp: '2026-02-02T00:00:04.500Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-2',
        output: 'OK'
      }
    },
    {
      timestamp: '2026-02-02T00:00:05.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: '完成。' }]
      }
    }
  ].map((entry) => JSON.stringify(entry)).join('\n');

  const activities = rawSessionActivitiesFromJsonl(content, turnWindow);

  assert.deepEqual(
    activities.map((item) => item.activity.kind),
    ['agent_message', 'command_execution', 'agent_message', 'mcp_tool_call']
  );
  assert.deepEqual(
    activities.map((item) => item.activity.label),
    ['先看状态。', '本地任务已处理', '再看页面。', '已完成一步操作']
  );
});
