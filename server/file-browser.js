/**
 * 本地文件浏览服务：解析桌面路径、列目录、创建/重命名空条目并生成常用根入口与文件编辑元数据。
 *
 * Keywords: file-browser, directory, roots, metadata, local-files
 *
 * Exports:
 * - localFileRoots — 返回 Home / 常用目录 / 当前工作目录等入口。
 * - listLocalDirectory — 读取指定目录并返回目录优先的文件条目。
 * - createLocalFileEntry — 在指定目录内创建空文件或文件夹并返回条目元数据。
 * - renameLocalFileEntry — 在同一父目录内重命名文件或文件夹。
 * - fileBrowserInternals — 测试用路径解析和排序辅助函数。
 * - isPathAllowed — 检查路径是否在允许的工作目录范围内。
 *
 * Inward: Node fs/os/path；static-service 的可编辑扩展名集合。
 *
 * Outward: file-routes 的 /api/files/roots 与 /api/files/list。
 *
 * 不负责: 文件内容读取、编辑保存与多格式预览。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITABLE_TEXT_EXTENSIONS } from './static-service.js';
import { defaultProjectlessWorkspaceRoot } from './codex-config.js';

const ROOT_DIR = path.parse(os.homedir()).root || path.sep;

/**
 * 获取允许访问的根目录列表。
 * 包含工作目录和 /tmp 目录。
 */
function getAllowedRoots() {
  const workspaceRoot = path.resolve(defaultProjectlessWorkspaceRoot());
  const tmpRoot = '/tmp';
  return [workspaceRoot, tmpRoot];
}

/**
 * 检查路径是否在允许的目录范围内。
 * @param {string} requestedPath - 请求的路径
 * @returns {{ allowed: boolean, allowedRoots: string[], resolvedPath: string }}
 */
export function isPathAllowed(requestedPath) {
  const allowedRoots = getAllowedRoots();
  const resolvedPath = path.resolve(requestedPath);
  
  for (const allowedRoot of allowedRoots) {
    const rootWithSep = allowedRoot.endsWith(path.sep) ? allowedRoot : `${allowedRoot}${path.sep}`;
    if (resolvedPath === allowedRoot || resolvedPath.startsWith(rootWithSep)) {
      return { allowed: true, allowedRoots, resolvedPath };
    }
  }
  
  return { allowed: false, allowedRoots, resolvedPath };
}

function rejectPathNotAllowed(resolvedPath, allowedRoots) {
  const error = new Error(`路径 "${resolvedPath}" 不在允许的工作目录范围内。允许的目录: ${allowedRoots.join(', ')}`);
  error.statusCode = 403;
  error.code = 'PATH_NOT_ALLOWED';
  error.allowedRoots = allowedRoots;
  return error;
}

function uniqueRoots(roots) {
  const seen = new Set();
  return roots.filter((root) => {
    const rootPath = path.resolve(String(root.path || ''));
    if (!rootPath || seen.has(rootPath)) {
      return false;
    }
    seen.add(rootPath);
    root.path = rootPath;
    return true;
  });
}

function resolveBrowserPath(value, { homedir = os.homedir() } = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    return homedir;
  }
  if (/^file:\/\//i.test(raw)) {
    return fileURLToPath(raw);
  }
  if (raw === '~') {
    return homedir;
  }
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(homedir, raw.slice(2));
  }
  return raw;
}

function entryKind(dirent, stat) {
  if (dirent.isDirectory() || stat.isDirectory()) {
    return 'directory';
  }
  if (dirent.isSymbolicLink()) {
    return stat.isDirectory() ? 'directory' : 'file';
  }
  return 'file';
}

function sortBrowserEntries(entries) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}

function rejectFileManagerError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizedEntryName(name) {
  const entryName = String(name || '').trim();
  if (!entryName) {
    throw rejectFileManagerError('File name is required');
  }
  if (entryName === '.' || entryName === '..' || entryName.includes('/') || entryName.includes('\\')) {
    throw rejectFileManagerError('File name cannot include path separators');
  }
  return entryName;
}

async function browserEntryFromDirent(root, dirent) {
  const filePath = path.join(root, dirent.name);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  const kind = entryKind(dirent, stat);
  const ext = kind === 'file' ? path.extname(filePath).toLowerCase() : '';
  return {
    name: dirent.name,
    path: filePath,
    kind,
    size: kind === 'file' ? stat.size : null,
    mtimeMs: Math.round(stat.mtimeMs),
    extension: ext,
    editable: kind === 'file' && EDITABLE_TEXT_EXTENSIONS.has(ext)
  };
}

async function browserEntryFromPath(filePath) {
  const stat = await fs.stat(filePath);
  const kind = stat.isDirectory() ? 'directory' : 'file';
  const ext = kind === 'file' ? path.extname(filePath).toLowerCase() : '';
  return {
    name: path.basename(filePath),
    path: filePath,
    kind,
    size: kind === 'file' ? stat.size : null,
    mtimeMs: Math.round(stat.mtimeMs),
    extension: ext,
    editable: kind === 'file' && EDITABLE_TEXT_EXTENSIONS.has(ext)
  };
}

export function localFileRoots({ cwd = process.cwd(), homedir = os.homedir() } = {}) {
  const allowedRoots = getAllowedRoots();
  return allowedRoots.map((rootPath, index) => ({
    id: index === 0 ? 'workspace' : `root-${index}`,
    label: path.basename(rootPath) || rootPath,
    path: rootPath
  }));
}

export async function listLocalDirectory(value, { limit = 500 } = {}) {
  const requestedPath = resolveBrowserPath(value);
  const dirPath = path.resolve(requestedPath);
  
  // 检查路径是否允许访问
  const pathCheck = isPathAllowed(dirPath);
  if (!pathCheck.allowed) {
    throw rejectPathNotAllowed(dirPath, pathCheck.allowedRoots);
  }
  
  let stat;
  try {
    stat = await fs.stat(dirPath);
  } catch (error) {
    error.statusCode = error.code === 'ENOENT' ? 404 : 500;
    throw error;
  }
  if (!stat.isDirectory()) {
    const error = new Error('Path is not a directory');
    error.statusCode = 400;
    throw error;
  }

  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  const entries = [];
  for (const dirent of dirents.slice(0, Math.max(1, Number(limit) || 500))) {
    const entry = await browserEntryFromDirent(dirPath, dirent);
    if (entry) {
      entries.push(entry);
    }
  }

  return {
    path: dirPath,
    parentPath: dirPath === path.parse(dirPath).root ? '' : path.dirname(dirPath),
    entries: sortBrowserEntries(entries),
    truncated: dirents.length > entries.length
  };
}

export async function createLocalFileEntry(value, { kind = 'file', name = '' } = {}) {
  const requestedPath = resolveBrowserPath(value);
  const dirPath = path.resolve(requestedPath);
  
  // 检查路径是否允许访问
  const pathCheck = isPathAllowed(dirPath);
  if (!pathCheck.allowed) {
    throw rejectPathNotAllowed(dirPath, pathCheck.allowedRoots);
  }
  
  const entryKindValue = kind === 'directory' ? 'directory' : 'file';
  const entryName = normalizedEntryName(name);

  let stat;
  try {
    stat = await fs.stat(dirPath);
  } catch (error) {
    error.statusCode = error.code === 'ENOENT' ? 404 : 500;
    throw error;
  }
  if (!stat.isDirectory()) {
    throw rejectFileManagerError('Path is not a directory');
  }

  const filePath = path.join(dirPath, entryName);
  try {
    if (entryKindValue === 'directory') {
      await fs.mkdir(filePath);
    } else {
      const handle = await fs.open(filePath, 'wx');
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw rejectFileManagerError('File already exists', 409);
    }
    throw error;
  }

  return {
    parentPath: dirPath,
    entry: await browserEntryFromPath(filePath)
  };
}

export async function renameLocalFileEntry(value, { name = '' } = {}) {
  const requestedPath = resolveBrowserPath(value);
  const filePath = path.resolve(requestedPath);
  
  // 检查路径是否允许访问
  const pathCheck = isPathAllowed(filePath);
  if (!pathCheck.allowed) {
    throw rejectPathNotAllowed(filePath, pathCheck.allowedRoots);
  }
  
  const entryName = normalizedEntryName(name);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    error.statusCode = error.code === 'ENOENT' ? 404 : 500;
    throw error;
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    throw rejectFileManagerError('Only files and directories can be renamed');
  }

  const parentPath = path.dirname(filePath);
  const nextPath = path.join(parentPath, entryName);
  if (nextPath === filePath) {
    return {
      oldPath: filePath,
      parentPath,
      entry: await browserEntryFromPath(filePath)
    };
  }
  try {
    await fs.lstat(nextPath);
    throw rejectFileManagerError('File already exists', 409);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.rename(filePath, nextPath);
  return {
    oldPath: filePath,
    parentPath,
    entry: await browserEntryFromPath(nextPath)
  };
}

export const fileBrowserInternals = {
  resolveBrowserPath,
  sortBrowserEntries
};
