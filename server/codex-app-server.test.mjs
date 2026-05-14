/**
 * 测试 server/codex-app-server.js：桌面线程列表参数与归档态筛选。
 * Keywords: codex-app-server, archive, thread-list, tests
 * Exports: 无导出，内含用例
 * Inward: codex-app-server.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopThreadListRequestParams,
  filterDesktopThreadsForArchiveMode
} from './codex-app-server.js';

test('desktopThreadListRequestParams passes archived mode through to thread/list', () => {
  assert.deepEqual(desktopThreadListRequestParams({ cursor: 'next', limit: 25, archived: true }), {
    cursor: 'next',
    limit: 25,
    sortKey: 'updated_at',
    sortDirection: 'desc',
    archived: true
  });
});

test('filterDesktopThreadsForArchiveMode keeps archived threads only for archive box mode', () => {
  const threads = [
    { id: 'open-1', status: 'completed' },
    { id: 'archived-1', status: 'archived' },
    { id: 'archived-2', archived: true },
    { status: 'archived' }
  ];

  assert.deepEqual(filterDesktopThreadsForArchiveMode(threads, { archived: false }).map((thread) => thread.id), ['open-1']);
  assert.deepEqual(filterDesktopThreadsForArchiveMode(threads, { archived: true }).map((thread) => thread.id), [
    'open-1',
    'archived-1',
    'archived-2'
  ]);
});
