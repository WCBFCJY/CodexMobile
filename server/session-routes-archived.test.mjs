/**
 * 测试 server/session-routes.js：归档箱只读 API。
 * Keywords: session-routes, archive-box, tests
 * Exports: 无导出，内含用例
 * Inward: session-routes.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionRouteHandler } from './session-routes.js';

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}

test('GET /api/sessions/archived returns archived sessions from injected data source', async () => {
  const handler = createSessionRouteHandler({
    listProjects: () => [],
    getProject: () => null,
    getSession: () => null,
    listProjectSessions: () => [],
    renameSession: async () => null,
    deleteSession: async () => null,
    listArchivedSessions: async ({ limit }) => ({
      sessions: [
        {
          id: 'archived-1',
          title: '归档线程',
          summary: '已归档',
          projectPath: '/tmp/project',
          updatedAt: '2026-05-14T10:00:00.000Z',
          archivedAt: '2026-05-14T10:10:00.000Z',
          model: 'gpt-5.5',
          modelShort: '5.5 中'
        }
      ],
      syncedAt: '2026-05-14T10:11:00.000Z',
      source: `limit-${limit}`
    }),
    hideSessionMessage: async () => null,
    readSessionMessages: async () => ({ messages: [] }),
    refreshCodexCache: async () => ({ syncedAt: '', projects: [] }),
    broadcast: () => null,
    chatService: { sessionHasActiveWork: () => false }
  });
  const res = createResponse();
  const handled = await handler({ method: 'GET' }, res, new URL('http://codexmobile.test/api/sessions/archived?limit=1'));

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    sessions: [
      {
        id: 'archived-1',
        title: '归档线程',
        summary: '已归档',
        projectPath: '/tmp/project',
        updatedAt: '2026-05-14T10:00:00.000Z',
        archivedAt: '2026-05-14T10:10:00.000Z',
        model: 'gpt-5.5',
        modelShort: '5.5 中'
      }
    ],
    syncedAt: '2026-05-14T10:11:00.000Z',
    source: 'limit-1'
  });
});
