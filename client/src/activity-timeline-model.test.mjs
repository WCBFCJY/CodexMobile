import assert from 'node:assert/strict';
import test from 'node:test';
import { activityBodyItemsForDisplay, buildActivityTimeline } from './chat/activity-timeline-model.js';

test('activity body keeps tool steps without detail when mixed with detailed steps', () => {
  const commandStep = {
    id: 'command',
    type: 'command',
    label: '运行命令',
    detail: 'npm test'
  };
  const toolStep = {
    id: 'tool',
    type: 'tool',
    label: '执行操作',
    detail: ''
  };
  const planStep = {
    id: 'plan',
    type: 'plan',
    label: '更新计划',
    detail: ''
  };

  const { visibleBodyItems } = activityBodyItemsForDisplay([commandStep, toolStep, planStep], []);

  assert.deepEqual(
    visibleBodyItems.map((item) => item.id),
    ['command', 'tool', 'plan']
  );
});

test('activity timeline keeps tool batches next to their matching commentary', () => {
  const timeline = buildActivityTimeline([
    {
      id: 'commentary-1',
      kind: 'agent_message',
      label: '先看状态。'
    },
    {
      id: 'command-1',
      kind: 'command_execution',
      label: '本地任务已处理',
      command: 'git status --short',
      status: 'completed'
    },
    {
      id: 'commentary-2',
      kind: 'agent_message',
      label: '再跑构建。'
    },
    {
      id: 'command-2',
      kind: 'command_execution',
      label: '本地任务已处理',
      command: 'npm run build',
      status: 'completed'
    }
  ], false);

  assert.deepEqual(
    timeline.map((item) => item.type),
    ['text', 'meta', 'text', 'meta']
  );
  assert.equal(timeline[1].items[0].command, 'git status --short');
  assert.equal(timeline[3].items[0].command, 'npm run build');
});
