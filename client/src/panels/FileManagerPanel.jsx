/**
 * 本机文件管理面板：列出连接电脑目录、常用入口、路径跳转，并在桌面端内嵌现有预览页。
 *
 * Keywords: file-manager, local-files, directory, preview, drawer
 *
 * Exports:
 * - FileManagerPanel — 全屏文件浏览面板组件。
 *
 * Inward: apiFetch、file-manager-state、session-utils、本地项目列表与 lucide-react。
 *
 * Outward: AppShell 在 Drawer 底部入口打开后渲染。
 *
 * 不负责: 文件内容解析、保存编辑与危险文件操作。
 */

import { ArrowUp, ChevronLeft, ExternalLink, File, FileText, Folder, FolderOpen, HardDrive, Home, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import { fileManagerEntryOpenAction, sortFileManagerEntries } from '../file-manager-state.js';
import { compactPath, localFilePreviewPath } from '../app/session-utils.js';

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
  const visibleEntries = useMemo(() => {
    if (!normalizedQuery) {
      return sortFileManagerEntries(entries);
    }
    return sortFileManagerEntries(entries.filter((entry) => {
      const haystack = `${entry.name || ''} ${entry.path || ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    }));
  }, [entries, normalizedQuery]);

  const loadDirectory = useCallback(async (nextPath = '') => {
    dispatch({ type: 'loading', path: nextPath });
    setSelectedFile(null);
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
      loadDirectory(action.path);
      return;
    }
    if (action.type === 'preview') {
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

  return (
    <section className="file-manager-panel" role="dialog" aria-modal="true" aria-label="文件管理">
      <header className="file-manager-header">
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭文件管理">
          <ChevronLeft size={22} />
        </button>
        <div className="file-manager-title">
          <strong>文件管理</strong>
          <span>{currentPath ? compactPath(currentPath) : '本机文件'}</span>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭文件管理">
          <X size={20} />
        </button>
      </header>

      <div className="file-manager-body">
        <div className="file-manager-roots" aria-label="常用位置">
          {rootItems.map((root) => (
            <button key={`${root.id}-${root.path}`} type="button" onClick={() => { setQuery(''); loadDirectory(root.path); }}>
              {root.id === 'home' ? <Home size={15} /> : root.project ? <FolderOpen size={15} /> : <HardDrive size={15} />}
              <span>{root.label}</span>
            </button>
          ))}
        </div>
        {rootsError ? <div className="file-manager-inline-error">{rootsError}</div> : null}

        <form className="file-manager-location" onSubmit={submitPath}>
          <input value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} aria-label="文件路径" placeholder="/Users/..." />
          <button type="submit" aria-label="跳转路径">
            <ExternalLink size={15} />
          </button>
          <button type="button" onClick={() => state.parentPath && loadDirectory(state.parentPath)} disabled={!state.parentPath} aria-label="返回上级">
            <ArrowUp size={15} />
          </button>
          <button type="button" onClick={() => loadDirectory(currentPath)} disabled={state.loading} aria-label="刷新目录">
            {state.loading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
          </button>
        </form>

        <label className="file-manager-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前目录" aria-label="搜索当前目录" />
        </label>

        <div className="file-manager-workspace">
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
                <span className="file-manager-entry-kind">{entry.kind === 'directory' ? '目录' : entry.editable ? '可编辑' : '文件'}</span>
              </button>
            )) : null}
          </div>
          <aside className="file-manager-preview" aria-label="文件预览">
            {selectedFile?.path ? (
              <>
                <div className="file-manager-preview-head">
                  <div>
                    <strong>{selectedFile.name}</strong>
                    <span>{compactPath(selectedFile.path)}</span>
                  </div>
                  <a href={localFilePreviewPath(selectedFile.path)} target="_blank" rel="noreferrer noopener" aria-label="打开完整预览">
                    <ExternalLink size={16} />
                  </a>
                </div>
                <iframe
                  className="file-manager-preview-frame"
                  src={localFilePreviewPath(selectedFile.path)}
                  title={`预览 ${selectedFile.name || '文件'}`}
                />
              </>
            ) : (
              <div className="file-manager-preview-empty">
                <FileText size={26} />
                <strong>选择一个文件</strong>
                <span>桌面端会在这里查看或编辑文本文件。</span>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
