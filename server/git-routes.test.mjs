import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createGitRouteHandler } from './git-routes.js';

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = String(body || '');
    }
  };
}

function createRequest(method = 'GET') {
  const req = new EventEmitter();
  req.method = method;
  req.destroy = () => {};
  return req;
}

test('git route handler ignores non-git API routes', async () => {
  const handler = createGitRouteHandler({ gitService: {} });
  const req = createRequest('GET');
  const res = createResponse();
  const handled = await handler(req, res, new URL('http://localhost/api/projects'));

  assert.equal(handled, false);
  assert.equal(res.statusCode, null);
});

test('git route handler serves Git status with the existing response shape', async () => {
  const handler = createGitRouteHandler({
    gitService: {
      async status(projectId) {
        assert.equal(projectId, 'project-1');
        return { branch: 'codex/git-panel', clean: true };
      }
    }
  });
  const req = createRequest('GET');
  const res = createResponse();
  const handled = await handler(req, res, new URL('http://localhost/api/git/status?projectId=project-1'));

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    success: true,
    status: { branch: 'codex/git-panel', clean: true }
  });
});

test('git route handler reads branch creation bodies', async () => {
  const handler = createGitRouteHandler({
    gitService: {
      async createBranch(projectId, branchName) {
        assert.equal(projectId, 'project-1');
        assert.equal(branchName, 'codex/new-branch');
        return { branch: 'codex/new-branch' };
      }
    }
  });
  const req = createRequest('POST');
  const res = createResponse();
  const promise = handler(req, res, new URL('http://localhost/api/git/branch'));
  req.emit('data', JSON.stringify({ projectId: 'project-1', branchName: 'codex/new-branch' }));
  req.emit('end');
  const handled = await promise;

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    success: true,
    branch: 'codex/new-branch'
  });
});
