/**
 * 测试 client/src/app/useAppBootstrap.js：侧栏同步时非当前项目会话预加载选择。
 * Keywords: bootstrap, sidebar, preload, tests
 * Exports: 无导出 / 内含用例
 * Inward: useAppBootstrap.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsToPreloadForSidebar } from './useAppBootstrap.js';

test('projectsToPreloadForSidebar skips current and empty projects, then sorts recent first', () => {
  const projects = [
    { id: 'current', sessionCount: 8, updatedAt: '2026-05-19T12:00:00.000Z' },
    { id: 'empty-recent', sessionCount: 0, updatedAt: '2026-05-19T14:00:00.000Z' },
    { id: 'lifeos', sessionCount: 9, updatedAt: '2026-05-19T14:15:44.000Z' },
    { id: 'codexmobile', sessionCount: 49, updatedAt: '2026-05-19T04:57:51.000Z' }
  ];

  assert.deepEqual(
    projectsToPreloadForSidebar(projects, 'current').map((project) => project.id),
    ['lifeos', 'codexmobile']
  );
});
