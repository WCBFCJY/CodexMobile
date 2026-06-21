/**
 * 测试 server/file-browser.js：本地目录浏览、常用入口与文件元数据。
 * Keywords: file-browser, directory, local-files, tests
 * Exports: 无导出 / 内含用例
 * Inward: file-browser.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalFileEntry, fileBrowserInternals, isPathAllowed, listLocalDirectory, localFileRoots, renameLocalFileEntry } from './file-browser.js';

test('listLocalDirectory returns directories first with editable file metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-browser-'));
  process.env.CODEXMOBILE_WORKDIR = root;  // 设置允许访问的工作目录
  await fs.mkdir(path.join(root, 'notes'));
  await fs.writeFile(path.join(root, 'a-readme.md'), '# Hello');
  await fs.writeFile(path.join(root, 'z-archive.zip'), 'zip');

  const result = await listLocalDirectory(root);

  assert.equal(result.path, root);
  assert.equal(result.parentPath, path.dirname(root));
  assert.deepEqual(
    result.entries.map((entry) => [entry.name, entry.kind, entry.editable]),
    [
      ['notes', 'directory', false],
      ['a-readme.md', 'file', true],
      ['z-archive.zip', 'file', false]
    ]
  );
  delete process.env.CODEXMOBILE_WORKDIR;
});

test('listLocalDirectory rejects paths outside allowed workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-browser-'));
  process.env.CODEXMOBILE_WORKDIR = root;
  const filePath = path.join(root, 'plain.txt');
  await fs.writeFile(filePath, 'plain');

  // 空路径现在会检查是否在允许的工作目录内
  await assert.rejects(() => listLocalDirectory(''), /不在允许的工作目录范围内/);
  await assert.rejects(() => listLocalDirectory(filePath), /Path is not a directory/);
  delete process.env.CODEXMOBILE_WORKDIR;
});

test('isPathAllowed checks if path is within allowed workspace', () => {
  const testRoot = '/tmp/test-workspace';
  process.env.CODEXMOBILE_WORKDIR = testRoot;
  
  const allowed = isPathAllowed('/tmp/test-workspace/project');
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.allowedRoot, path.resolve(testRoot));
  
  const notAllowed = isPathAllowed('/etc/passwd');
  assert.equal(notAllowed.allowed, false);
  
  delete process.env.CODEXMOBILE_WORKDIR;
});

test('localFileRoots returns single allowed workspace directory', () => {
  const testRoot = '/tmp/project';
  process.env.CODEXMOBILE_WORKDIR = testRoot;
  const roots = localFileRoots({ cwd: '/tmp/project', homedir: '/Users/example' });
  // 现在只返回一个允许的工作目录
  assert.equal(roots.length, 1);
  assert.equal(roots[0].id, 'workspace');
  assert.equal(roots[0].path, path.resolve(testRoot));
  delete process.env.CODEXMOBILE_WORKDIR;
});

test('file browser path helpers expand user-home shorthand', () => {
  assert.equal(
    fileBrowserInternals.resolveBrowserPath('~/Desktop', { homedir: '/Users/example' }),
    path.join('/Users/example', 'Desktop')
  );
});

test('createLocalFileEntry creates empty files and directories inside a browsed folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-create-'));
  process.env.CODEXMOBILE_WORKDIR = root;

  const fileEntry = await createLocalFileEntry(root, { kind: 'file', name: 'note.md' });
  const directoryEntry = await createLocalFileEntry(root, { kind: 'directory', name: 'drafts' });

  assert.equal(await fs.readFile(path.join(root, 'note.md'), 'utf8'), '');
  assert.equal((await fs.stat(path.join(root, 'drafts'))).isDirectory(), true);
  assert.deepEqual(
    [fileEntry.entry.name, fileEntry.entry.kind, fileEntry.entry.editable],
    ['note.md', 'file', true]
  );
  assert.deepEqual(
    [directoryEntry.entry.name, directoryEntry.entry.kind, directoryEntry.entry.path],
    ['drafts', 'directory', path.join(root, 'drafts')]
  );
  delete process.env.CODEXMOBILE_WORKDIR;
});

test('createLocalFileEntry rejects nested names and existing entries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-create-'));
  process.env.CODEXMOBILE_WORKDIR = root;
  await fs.writeFile(path.join(root, 'taken.md'), '');

  await assert.rejects(
    () => createLocalFileEntry(root, { kind: 'file', name: '../escape.md' }),
    /File name cannot include path separators/
  );
  await assert.rejects(
    () => createLocalFileEntry(root, { kind: 'file', name: 'taken.md' }),
    /File already exists/
  );
  delete process.env.CODEXMOBILE_WORKDIR;
});

test('renameLocalFileEntry renames files and directories without changing parent folders', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-rename-'));
  process.env.CODEXMOBILE_WORKDIR = root;
  const filePath = path.join(root, 'old.md');
  const directoryPath = path.join(root, 'drafts');
  await fs.writeFile(filePath, '# Old');
  await fs.mkdir(directoryPath);

  const fileResult = await renameLocalFileEntry(filePath, { name: 'new.md' });
  const directoryResult = await renameLocalFileEntry(directoryPath, { name: 'notes' });

  assert.equal(await fs.readFile(path.join(root, 'new.md'), 'utf8'), '# Old');
  assert.equal((await fs.stat(path.join(root, 'notes'))).isDirectory(), true);
  assert.deepEqual(
    [fileResult.oldPath, fileResult.parentPath, fileResult.entry.name, fileResult.entry.kind],
    [filePath, root, 'new.md', 'file']
  );
  assert.deepEqual(
    [directoryResult.oldPath, directoryResult.parentPath, directoryResult.entry.name, directoryResult.entry.kind],
    [directoryPath, root, 'notes', 'directory']
  );
  delete process.env.CODEXMOBILE_WORKDIR;
});

test('renameLocalFileEntry rejects nested names and existing targets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-rename-'));
  process.env.CODEXMOBILE_WORKDIR = root;
  const filePath = path.join(root, 'old.md');
  await fs.writeFile(filePath, '# Old');
  await fs.writeFile(path.join(root, 'taken.md'), '# Taken');

  await assert.rejects(
    () => renameLocalFileEntry(filePath, { name: '../escape.md' }),
    /File name cannot include path separators/
  );
  await assert.rejects(
    () => renameLocalFileEntry(filePath, { name: 'taken.md' }),
    /File already exists/
  );
  delete process.env.CODEXMOBILE_WORKDIR;
});

test('file operations reject paths outside allowed workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-file-outside-'));
  process.env.CODEXMOBILE_WORKDIR = root;
  
  // 尝试访问不在允许列表中的路径
  await assert.rejects(
    () => listLocalDirectory('/etc'),
    /不在允许的工作目录范围内/
  );
  
  await assert.rejects(
    () => createLocalFileEntry('/tmp', { kind: 'file', name: 'test.txt' }),
    /不在允许的工作目录范围内/
  );
  
  const outsideFile = path.join(os.tmpdir(), 'outside-test.md');
  await fs.writeFile(outsideFile, 'test');
  await assert.rejects(
    () => renameLocalFileEntry(outsideFile, { name: 'renamed.md' }),
    /不在允许的工作目录范围内/
  );
  
  delete process.env.CODEXMOBILE_WORKDIR;
});
