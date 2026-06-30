/**
 * 测试 server/codex-runner.js：状态标签辅助。
 *
 * Keywords: codex-runner, test, status
 *
 * Exports: 无导出，内含用例
 *
 * Inward: codex-runner.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { statusLabel } from './codex-runner.js';

test('statusLabel uses mobile-friendly command labels', () => {
  assert.equal(statusLabel('command_execution', 'running'), '正在处理本地任务');
  assert.equal(statusLabel('command_execution', 'completed'), '本地任务已处理');
  assert.equal(statusLabel('command_execution', 'failed'), '本地任务失败');
});

test('statusLabel uses mobile-friendly tool and file labels', () => {
  assert.equal(statusLabel('mcp_tool_call', 'running'), '正在完成一步操作');
  assert.equal(statusLabel('mcp_tool_call', 'completed'), '已完成一步操作');
  assert.equal(statusLabel('file_change', 'running'), '正在更新文件');
  assert.equal(statusLabel('file_change', 'completed'), '文件已更新');
});

test('statusLabel uses mobile-friendly reasoning labels', () => {
  assert.equal(statusLabel('reasoning', 'running'), '正在思考');
  assert.equal(statusLabel('reasoning', 'completed'), '思考完成');
});

test('statusLabel uses mobile-friendly turn labels', () => {
  assert.equal(statusLabel('turn', 'running'), '正在处理');
  assert.equal(statusLabel('turn', 'completed'), '任务已完成');
  assert.equal(statusLabel('turn', 'failed'), '任务失败');
});
