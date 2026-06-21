/**
 * 测试 server/permission-policy.js：权限模式到 Codex 与桌面沙箱策略的映射。
 *
 * Keywords: permission-policy, sandbox, danger-full-access, test
 *
 * Exports: 无导出，内含用例
 *
 * Inward: permission-policy.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  codexSandboxForPermissionMode,
  desktopSandboxPolicyForPermissionMode,
  desktopTurnPermissionsForPermissionMode,
  normalizePermissionMode
} from './permission-policy.js';

test('bypassPermissions is rejected unless danger full access is explicitly enabled', () => {
  assert.throws(() => normalizePermissionMode('bypassPermissions'), /danger-full-access is disabled/);
  assert.equal(normalizePermissionMode('bypassPermissions', { dangerFullAccessEnabled: true }), 'bypassPermissions');
});

test('sandboxOff is rejected unless danger full access is explicitly enabled', () => {
  assert.throws(() => normalizePermissionMode('sandboxOff'), /danger-full-access is disabled/);
  assert.equal(normalizePermissionMode('sandboxOff', { dangerFullAccessEnabled: true }), 'sandboxOff');
});

test('unknown permission modes fall back to default', () => {
  assert.equal(normalizePermissionMode('unknown'), 'default');
  assert.deepEqual(codexSandboxForPermissionMode('unknown'), {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request'
  });
});

test('default mode uses workspace-write with on-request approval', () => {
  assert.deepEqual(codexSandboxForPermissionMode('default'), {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request'
  });
});

test('acceptEdits mode uses workspace-write with never approval', () => {
  assert.deepEqual(codexSandboxForPermissionMode('acceptEdits'), {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never'
  });
});

test('sandboxOff mode uses danger-full-access with on-request approval', () => {
  assert.deepEqual(codexSandboxForPermissionMode('sandboxOff', { dangerFullAccessEnabled: true }), {
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'on-request'
  });
});

test('bypassPermissions mode uses danger-full-access with never approval', () => {
  assert.deepEqual(codexSandboxForPermissionMode('bypassPermissions', { dangerFullAccessEnabled: true }), {
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never'
  });
});

test('desktop policies switch between workspace-write and danger full access', () => {
  assert.deepEqual(desktopSandboxPolicyForPermissionMode('acceptEdits', {
    writableRoots: ['/repo'],
    networkAccess: true
  }), {
    type: 'workspaceWrite',
    writableRoots: ['/repo'],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  });
  assert.deepEqual(desktopTurnPermissionsForPermissionMode('default', { writableRoots: ['/repo'] }), {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'guardian_subagent',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: ['/repo'],
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    }
  });
  assert.deepEqual(desktopSandboxPolicyForPermissionMode('bypassPermissions', { dangerFullAccessEnabled: true }), {
    type: 'dangerFullAccess'
  });
  assert.deepEqual(desktopSandboxPolicyForPermissionMode('sandboxOff', { dangerFullAccessEnabled: true }), {
    type: 'dangerFullAccess'
  });
});

test('desktop sandboxOff permissions use on-request approval', () => {
  assert.deepEqual(desktopTurnPermissionsForPermissionMode('sandboxOff', { dangerFullAccessEnabled: true }), {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: { type: 'dangerFullAccess' }
  });
});
