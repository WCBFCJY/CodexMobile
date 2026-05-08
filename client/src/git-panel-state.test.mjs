import assert from 'node:assert/strict';
import test from 'node:test';
import { gitActionBlockReason, gitChangedFileCount, gitSafetyWarnings } from './git-panel-state.js';

test('gitChangedFileCount prefers server total over displayed file slice', () => {
  assert.equal(gitChangedFileCount({ fileCount: 5388, files: [{ path: 'a' }] }), 5388);
});

test('gitSafetyWarnings reports large truncated working trees clearly', () => {
  const warnings = gitSafetyWarnings({
    branch: 'main',
    fileCount: 5388,
    filesTruncated: true,
    files: Array.from({ length: 500 }, (_, index) => ({ path: `file-${index}` }))
  });

  assert.deepEqual(warnings, [
    '工作区有 5388 个改动文件',
    '仅显示前 500 个文件',
    '当前不是 codex/ 分支',
    '当前分支没有 upstream'
  ]);
});

test('gitActionBlockReason blocks mobile git actions on non-codex branches', () => {
  assert.equal(
    gitActionBlockReason({ branch: 'main', canCommit: true, fileCount: 1 }, 'commit'),
    '移动端只允许在 codex/ 分支执行提交或推送'
  );
});

test('gitActionBlockReason blocks huge dirty worktrees before commit or push', () => {
  assert.equal(
    gitActionBlockReason({ branch: 'codex/git-fix', canCommit: true, fileCount: 501 }, 'push'),
    '改动文件过多，请先在桌面端确认范围'
  );
});

test('gitActionBlockReason allows focused codex branch actions', () => {
  assert.equal(gitActionBlockReason({ branch: 'codex/git-fix', canCommit: true, fileCount: 3 }, 'commit'), '');
});
