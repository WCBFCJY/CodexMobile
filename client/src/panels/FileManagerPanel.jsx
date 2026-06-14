/**
 * 本机文件管理面板：左侧集中目录浏览与位置操作，右侧整屏承载桌面端文件预览/编辑。
 *
 * Keywords: file-manager, local-files, directory, preview, desktop-workbench
 *
 * Exports:
 * - FileManagerPanel — 全屏文件浏览面板组件。
 *
 * Inward: apiFetch、file-manager-state、session-utils、clipboard、本地项目列表与 lucide-react。
 *
 * Outward: AppShell 在 Drawer 底部入口打开后渲染。
 *
 * 不负责: 文件内容解析、保存编辑与危险文件操作。
 */

import { ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, File, FilePlus, FileText, Folder, FolderOpen, FolderPlus, HardDrive, Home, Loader2, MapPinned, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import { fileManagerEntryOpenAction, flattenFileManagerTree, sortFileManagerEntries } from '../file-manager-state.js';
import { compactPath, localFileApiPath, localFilePreviewPath } from '../app/session-utils.js';
import { copyTextToClipboard } from '../utils/clipboard.js';

function entryIcon(entry) {
  if (entry.kind === 'directory') {
    return <Folder size={17} />;
  }
  if (entry.editable || /\.(?:md|txt|json|js|jsx|ts|tsx|css|html?|csv)$/i.test(entry.name || '')) {
    return <FileText size={17} />;
  }
  return <File size={17} />;
}

function formatFileSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatMtime(value) {
  if (!value) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(Number(value)));
  } catch {
    return '';
  }
}

function projectRoots(projects = []) {
  return (Array.isArray(projects) ? projects : [])
    .filter((project) => !project.projectless && project.path)
    .slice(0, 8)
    .map((project) => ({
      id: `project-${project.id}`,
      label: project.name || 'Project',
      path: project.path,
      project: true
    }));
}

function dedupeRoots(roots = []) {
  const seen = new Set();
  return roots.filter((root) => {
    const rootPath = String(root.path || '').trim();
    if (!rootPath || seen.has(rootPath)) {
      return false;
    }
    seen.add(rootPath);
    return true;
  });
}

function defaultCreateName(kind) {
  return kind === 'directory' ? '新建文件夹' : '未命名.md';
}

function mapPathPrefix(value, oldPath, newPath) {
  const source = String(value || '');
  if (!source || !oldPath || !newPath) {
    return source;
  }
  if (source === oldPath) {
    return newPath;
  }
  if (source.startsWith(`${oldPath}/`)) {
    return `${newPath}${source.slice(oldPath.length)}`;
  }
  return source;
}

function remapPathRecord(record = {}, oldPath = '', newPath = '') {
  return Object.entries(record || {}).reduce((next, [key, value]) => {
    next[mapPathPrefix(key, oldPath, newPath)] = value;
    return next;
  }, {});
}

export function FileManagerPanel({
  open,
  state,
  dispatch,
  projects,
  selectedProject,
  onClose
}) {
  const [roots, setRoots] = useState([]);
  const [rootsError, setRootsError] = useState('');
  const [pathDraft, setPathDraft] = useState('');
  const [query, setQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [rootsMenuOpen, setRootsMenuOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deletingPath, setDeletingPath] = useState('');
  const [creatingKind, setCreatingKind] = useState('');
  const [renamingPath, setRenamingPath] = useState('');
  const [copiedPath, setCopiedPath] = useState('');
  const [treeExpandedByPath, setTreeExpandedByPath] = useState({});
  const [treeChildrenByPath, setTreeChildrenByPath] = useState({});
  const [treeLoadingByPath, setTreeLoadingByPath] = useState({});
  const [desktopPreview, setDesktopPreview] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }
    return window.matchMedia('(min-width: 900px)').matches;
  });
  const currentPath = state?.path || '';
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  const projectRootItems = useMemo(() => projectRoots(projects), [projects]);
  const rootItems = useMemo(() => dedupeRoots([
    ...(selectedProject?.path ? [{ id: `selected-${selectedProject.id}`, label: selectedProject.name || '当前项目', path: selectedProject.path, project: true }] : []),
    ...projectRootItems,
    ...roots
  ]), [projectRootItems, roots, selectedProject]);
  const normalizedQuery = query.trim().toLowerCase();
  const searchVisible = searchExpanded || Boolean(query);
  const visibleEntries = useMemo(() => {
    if (!normalizedQuery) {
      return sortFileManagerEntries(entries);
    }
    return sortFileManagerEntries(entries.filter((entry) => {
      const haystack = `${entry.name || ''} ${entry.path || ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    }));
  }, [entries, normalizedQuery]);
  const treeRows = useMemo(() => {
    const rows = flattenFileManagerTree({
      entries,
      expandedByPath: treeExpandedByPath,
      childrenByPath: treeChildrenByPath,
      loadingByPath: treeLoadingByPath
    });
    if (!normalizedQuery) {
      return rows;
    }
    return rows.filter((row) => {
      const haystack = `${row.entry.name || ''} ${row.entry.path || ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [entries, normalizedQuery, treeChildrenByPath, treeExpandedByPath, treeLoadingByPath]);

  const loadDirectory = useCallback(async (nextPath = '') => {
    dispatch({ type: 'loading', path: nextPath });
    setSelectedFile(null);
    setDeleteError('');
    setTreeExpandedByPath({});
    setTreeChildrenByPath({});
    setTreeLoadingByPath({});
    try {
      const params = new URLSearchParams();
      if (nextPath) {
        params.set('path', nextPath);
      }
      const data = await apiFetch(`/api/files/list?${params.toString()}`);
      dispatch({
        type: 'loaded',
        path: data.path || nextPath,
        parentPath: data.parentPath || '',
        entries: Array.isArray(data.entries) ? data.entries : []
      });
      setPathDraft(data.path || nextPath);
    } catch (error) {
      dispatch({ type: 'failed', error: error?.message || '目录读取失败' });
    }
  }, [dispatch]);

  async function refreshCurrentTree({
    clearSelected = false,
    selectedEntry = null,
    pathMap = null
  } = {}) {
    const mappedExpandedByPath = pathMap
      ? remapPathRecord(treeExpandedByPath, pathMap.oldPath, pathMap.newPath)
      : treeExpandedByPath;
    if (pathMap) {
      setTreeExpandedByPath(mappedExpandedByPath);
      setTreeChildrenByPath((value) => remapPathRecord(value, pathMap.oldPath, pathMap.newPath));
      setSelectedFile((value) => {
        if (!value?.path) {
          return value;
        }
        return {
          ...value,
          path: mapPathPrefix(value.path, pathMap.oldPath, pathMap.newPath)
        };
      });
    }

    dispatch({ type: 'loading', path: currentPath });
    try {
      const params = new URLSearchParams();
      if (currentPath) {
        params.set('path', currentPath);
      }
      const data = await apiFetch(`/api/files/list?${params.toString()}`);
      dispatch({
        type: 'loaded',
        path: data.path || currentPath,
        parentPath: data.parentPath || '',
        entries: Array.isArray(data.entries) ? data.entries : []
      });
      setPathDraft(data.path || currentPath);

      const expandedPaths = Object.keys(mappedExpandedByPath).filter((path) => mappedExpandedByPath[path]);
      const nextChildrenByPath = {};
      await Promise.all(expandedPaths.map(async (path) => {
        const childParams = new URLSearchParams({ path });
        const childData = await apiFetch(`/api/files/list?${childParams.toString()}`);
        nextChildrenByPath[path] = Array.isArray(childData.entries) ? childData.entries : [];
      }));
      setTreeChildrenByPath((value) => ({
        ...value,
        ...nextChildrenByPath
      }));
      if (clearSelected) {
        setSelectedFile(null);
      } else if (selectedEntry?.kind === 'file') {
        setSelectedFile(selectedEntry);
      }
    } catch (error) {
      dispatch({ type: 'failed', error: error?.message || '目录读取失败' });
    }
  }

  useEffect(() => {
    if (!open || typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }
    const queryList = window.matchMedia('(min-width: 900px)');
    const syncDesktopPreview = () => setDesktopPreview(queryList.matches);
    syncDesktopPreview();
    queryList.addEventListener?.('change', syncDesktopPreview);
    return () => {
      queryList.removeEventListener?.('change', syncDesktopPreview);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let stopped = false;
    async function loadRoots() {
      setRootsError('');
      try {
        const data = await apiFetch('/api/files/roots');
        if (!stopped) {
          setRoots(Array.isArray(data.roots) ? data.roots : []);
        }
      } catch (error) {
        if (!stopped) {
          setRootsError(error?.message || '常用位置读取失败');
        }
      }
    }
    loadRoots();
    loadDirectory(currentPath);
    return () => {
      stopped = true;
    };
  }, [open, currentPath, loadDirectory]);

  useEffect(() => {
    if (open) {
      setPathDraft(currentPath);
    }
  }, [currentPath, open]);

  if (!open) {
    return null;
  }

  function openEntry(entry) {
    const action = fileManagerEntryOpenAction(entry, { desktop: desktopPreview });
    if (action.type === 'directory') {
      setQuery('');
      if (desktopPreview) {
        toggleTreeDirectory(entry);
        return;
      }
      loadDirectory(action.path);
      return;
    }
    if (action.type === 'preview') {
      setDeleteError('');
      setSelectedFile(entry);
      return;
    }
    window.location.href = localFilePreviewPath(action.path);
  }

  function submitPath(event) {
    event.preventDefault();
    setQuery('');
    loadDirectory(pathDraft);
  }

  function openRoot(rootPath) {
    setQuery('');
    setRootsMenuOpen(false);
    loadDirectory(rootPath);
  }

  async function toggleTreeDirectory(entry) {
    const path = entry?.path || '';
    if (!path) {
      return;
    }
    const shouldExpand = !treeExpandedByPath[path];
    setTreeExpandedByPath((value) => ({
      ...value,
      [path]: shouldExpand
    }));
    if (!shouldExpand || treeChildrenByPath[path] || treeLoadingByPath[path]) {
      return;
    }
    setDeleteError('');
    setTreeLoadingByPath((value) => ({ ...value, [path]: true }));
    try {
      const params = new URLSearchParams({ path });
      const data = await apiFetch(`/api/files/list?${params.toString()}`);
      setTreeChildrenByPath((value) => ({
        ...value,
        [path]: Array.isArray(data.entries) ? data.entries : []
      }));
    } catch (error) {
      setDeleteError(error?.message || '目录读取失败');
    } finally {
      setTreeLoadingByPath((value) => ({ ...value, [path]: false }));
    }
  }

  function toggleSearch() {
    setSearchExpanded((value) => !value);
  }

  async function handleCopyTreePath(event, entry) {
    event.stopPropagation();
    const path = entry?.path || '';
    if (!path) {
      return;
    }
    const ok = await copyTextToClipboard(path);
    if (!ok) {
      setDeleteError('复制路径失败');
      return;
    }
    setDeleteError('');
    setCopiedPath(path);
    window.setTimeout(() => {
      setCopiedPath((value) => (value === path ? '' : value));
    }, 1200);
  }

  async function handleCreateEntry(kind) {
    if (!desktopPreview || creatingKind) {
      return;
    }
    const entryKindValue = kind === 'directory' ? 'directory' : 'file';
    const label = entryKindValue === 'directory' ? '文件夹' : '文档';
    const name = window.prompt(`新建${label}名称`, defaultCreateName(entryKindValue))?.trim();
    if (!name) {
      return;
    }
    setDeleteError('');
    setCreatingKind(entryKindValue);
    try {
      const data = await apiFetch('/api/files/create', {
        method: 'POST',
        body: {
          path: currentPath,
          kind: entryKindValue,
          name
        }
      });
      setQuery('');
      await refreshCurrentTree({ selectedEntry: data.entry?.kind === 'file' ? data.entry : null });
    } catch (error) {
      setDeleteError(error?.message || '创建失败');
    } finally {
      setCreatingKind('');
    }
  }

  async function handleRenameTreeEntry(event, entry) {
    event.stopPropagation();
    if (!entry?.path || renamingPath) {
      return;
    }
    const name = window.prompt(`重命名${entry.kind === 'directory' ? '文件夹' : '文件'}`, entry.name || '')?.trim();
    if (!name || name === entry.name) {
      return;
    }
    setDeleteError('');
    setRenamingPath(entry.path);
    try {
      const data = await apiFetch('/api/files/rename', {
        method: 'POST',
        body: {
          path: entry.path,
          name
        }
      });
      setQuery('');
      await refreshCurrentTree({
        selectedEntry: data.entry?.kind === 'file' ? data.entry : null,
        pathMap: data.oldPath && data.entry?.path ? { oldPath: data.oldPath, newPath: data.entry.path } : null
      });
    } catch (error) {
      setDeleteError(error?.message || '重命名失败');
    } finally {
      setRenamingPath('');
    }
  }

  async function deleteSelectedFile() {
    if (!selectedFile?.path || selectedFile.kind === 'directory' || deletingPath) {
      return;
    }
    const confirmed = window.confirm(`删除文件「${selectedFile.name || '未命名文件'}」？`);
    if (!confirmed) {
      return;
    }
    setDeleteError('');
    setDeletingPath(selectedFile.path);
    try {
      await apiFetch(localFileApiPath(selectedFile.path), { method: 'DELETE' });
      await refreshCurrentTree({ clearSelected: true });
    } catch (error) {
      setDeleteError(error?.message || '删除失败');
    } finally {
      setDeletingPath('');
    }
  }

  return (
    <section className="file-manager-panel" role="dialog" aria-modal="true" aria-label="文件管理">
      <div className="file-manager-shell">
        <aside className="file-manager-sidebar" aria-label="文件浏览">
          <header className="file-manager-header">
            <button className="icon-button" type="button" onClick={onClose} aria-label="关闭文件管理">
              <ChevronLeft size={22} />
            </button>
            <div className="file-manager-title">
              <strong>文件管理</strong>
              <span>{currentPath ? compactPath(currentPath) : '本机文件'}</span>
            </div>
          </header>

          <div className="file-manager-sidebar-actions">
            <div className="file-manager-root-menu">
              <button
                type="button"
                className="file-manager-tool-button"
                onClick={() => setRootsMenuOpen((value) => !value)}
                aria-label="常用位置"
                aria-expanded={rootsMenuOpen ? 'true' : 'false'}
              >
                <MapPinned size={16} />
                <span>位置</span>
                <ChevronDown size={14} />
              </button>
              {rootsMenuOpen ? (
                <div className="file-manager-root-popover" role="menu" aria-label="常用位置">
                  {rootItems.map((root) => (
                    <button key={`${root.id}-${root.path}`} type="button" onClick={() => openRoot(root.path)} role="menuitem">
                      {root.id === 'home' ? <Home size={15} /> : root.project ? <FolderOpen size={15} /> : <HardDrive size={15} />}
                      <span>{root.label}</span>
                      <small>{compactPath(root.path)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button className="file-manager-tool-button is-icon" type="button" onClick={() => state.parentPath && loadDirectory(state.parentPath)} disabled={!state.parentPath} aria-label="返回上级">
              <ArrowUp size={16} />
            </button>
            <button className="file-manager-tool-button is-icon" type="button" onClick={() => loadDirectory(currentPath)} disabled={state.loading} aria-label="刷新目录">
              {state.loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            </button>
            {desktopPreview ? (
              <>
                <button
                  className="file-manager-tool-button is-icon"
                  type="button"
                  onClick={() => handleCreateEntry('file')}
                  disabled={state.loading || Boolean(creatingKind)}
                  aria-label="新建空文档"
                >
                  {creatingKind === 'file' ? <Loader2 className="spin" size={16} /> : <FilePlus size={16} />}
                </button>
                <button
                  className="file-manager-tool-button is-icon"
                  type="button"
                  onClick={() => handleCreateEntry('directory')}
                  disabled={state.loading || Boolean(creatingKind)}
                  aria-label="新建文件夹"
                >
                  {creatingKind === 'directory' ? <Loader2 className="spin" size={16} /> : <FolderPlus size={16} />}
                </button>
              </>
            ) : null}
            {selectedFile?.path ? (
              <a className="file-manager-tool-button is-icon" href={localFilePreviewPath(selectedFile.path)} target="_blank" rel="noreferrer noopener" aria-label="打开完整预览">
                <ExternalLink size={16} />
              </a>
            ) : null}
            {selectedFile?.path && selectedFile.kind !== 'directory' ? (
              <button
                className="file-manager-tool-button is-icon is-danger"
                type="button"
                onClick={deleteSelectedFile}
                disabled={deletingPath === selectedFile.path}
                aria-label="删除文件"
              >
                {deletingPath === selectedFile.path ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
              </button>
            ) : null}
            <div className={`file-manager-search-toggle ${searchVisible ? 'is-open' : ''}`}>
              <button className="file-manager-tool-button is-icon" type="button" onClick={toggleSearch} aria-label="搜索当前目录" aria-expanded={searchVisible ? 'true' : 'false'}>
                <Search size={16} />
              </button>
              {searchVisible ? (
                <label className="file-manager-search">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索当前目录"
                    aria-label="搜索当前目录"
                    autoFocus
                  />
                </label>
              ) : null}
            </div>
          </div>

          {rootsError || deleteError ? <div className="file-manager-inline-error">{deleteError || rootsError}</div> : null}

          <form className="file-manager-location" onSubmit={submitPath}>
            <input value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} aria-label="文件路径" placeholder="/Users/..." />
            <button type="submit" aria-label="跳转路径">
              <ExternalLink size={15} />
            </button>
          </form>

          {desktopPreview ? (
            <div className="file-manager-tree" role="tree" aria-busy={state.loading ? 'true' : 'false'}>
              {state.loading ? <div className="file-manager-status">正在读取目录...</div> : null}
              {!state.loading && state.error ? <div className="file-manager-error">{state.error}</div> : null}
              {!state.loading && !state.error && treeRows.length === 0 ? (
                <div className="file-manager-status">{normalizedQuery ? '没有匹配文件' : '这个目录是空的'}</div>
              ) : null}
              {!state.loading && !state.error ? treeRows.map((row) => (
                <div
                  key={row.entry.path}
                  className={`file-manager-tree-row ${selectedFile?.path === row.entry.path ? 'is-selected' : ''}`}
                  style={{ '--tree-depth': row.depth }}
                  onClick={() => openEntry(row.entry)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openEntry(row.entry);
                    }
                  }}
                  role="treeitem"
                  tabIndex={0}
                  aria-level={row.depth + 1}
                  aria-expanded={row.expandable ? (row.expanded ? 'true' : 'false') : undefined}
                >
                  <span className="file-manager-tree-twist" aria-hidden="true">
                    {row.loading ? <Loader2 className="spin" size={13} /> : row.expandable ? (row.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
                  </span>
                  <span className={`file-manager-tree-icon is-${row.entry.kind}`} aria-hidden="true">
                    {entryIcon(row.entry)}
                  </span>
                  <span className="file-manager-tree-name">{row.entry.name}</span>
                  <span className={`file-manager-tree-quick-actions ${copiedPath === row.entry.path || renamingPath === row.entry.path ? 'is-active' : ''}`}>
                    <button
                      type="button"
                      className="file-manager-tree-action"
                      onClick={(event) => handleRenameTreeEntry(event, row.entry)}
                      disabled={renamingPath === row.entry.path}
                      aria-label={`重命名 ${row.entry.name || ''}`}
                    >
                      {renamingPath === row.entry.path ? <Loader2 className="spin" size={13} /> : <Pencil size={13} />}
                    </button>
                    <button
                      type="button"
                      className={`file-manager-tree-action file-manager-tree-copy ${copiedPath === row.entry.path ? 'is-copied' : ''}`}
                      onClick={(event) => handleCopyTreePath(event, row.entry)}
                      aria-label={`复制路径 ${row.entry.name || ''}`}
                    >
                      {copiedPath === row.entry.path ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </span>
                </div>
              )) : null}
            </div>
          ) : (
            <div className="file-manager-list" role="list" aria-busy={state.loading ? 'true' : 'false'}>
              {state.loading ? <div className="file-manager-status">正在读取目录...</div> : null}
              {!state.loading && state.error ? <div className="file-manager-error">{state.error}</div> : null}
              {!state.loading && !state.error && visibleEntries.length === 0 ? (
                <div className="file-manager-status">{normalizedQuery ? '没有匹配文件' : '这个目录是空的'}</div>
              ) : null}
              {!state.loading && !state.error ? visibleEntries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={`file-manager-row ${selectedFile?.path === entry.path ? 'is-selected' : ''}`}
                  onClick={() => openEntry(entry)}
                  role="listitem"
                >
                  <span className={`file-manager-entry-icon is-${entry.kind}`} aria-hidden="true">
                    {entryIcon(entry)}
                  </span>
                  <span className="file-manager-entry-main">
                    <strong>{entry.name}</strong>
                    <small>{entry.kind === 'directory' ? compactPath(entry.path) : [formatFileSize(entry.size), formatMtime(entry.mtimeMs)].filter(Boolean).join(' · ')}</small>
                  </span>
                </button>
              )) : null}
            </div>
          )}
        </aside>

        <main className="file-manager-preview" aria-label="文件预览">
          {selectedFile?.path ? (
            <iframe
              className="file-manager-preview-frame"
              src={localFilePreviewPath(selectedFile.path, { embed: true })}
              title={`预览 ${selectedFile.name || '文件'}`}
            />
            ) : (
            <div className="file-manager-preview-empty">
              <FileText size={30} />
              <strong>选择一个文件</strong>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
