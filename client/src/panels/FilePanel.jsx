/**
 * PC 端右侧文件面板：上部预览区 + 下部文件树。
 * 严格对齐 FileManagerPanel 的行为。
 *
 * Keywords: file-panel, pc-only, preview, tree
 *
 * Exports:
 * - FilePanel — PC 端三栏布局右侧面板。
 */

import { ChevronDown, ChevronRight, Copy, File, FilePlus, FileText, Folder, FolderOpen, FolderPlus, HardDrive, Home, Loader2, MapPinned, Pencil, RefreshCw, Search, Trash2, ArrowUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api.js';
import { fileManagerEntryOpenAction, flattenFileManagerTree, sortFileManagerEntries } from '../file-manager-state.js';
import { compactPath, localFilePreviewPath } from '../app/session-utils.js';
import { copyTextToClipboard } from '../utils/clipboard.js';

function entryIcon(entry, expanded) {
  if (entry.kind === 'directory') {
    return expanded ? <FolderOpen size={16} /> : <Folder size={16} />;
  }
  if (entry.editable || /\.(?:md|txt|json|js|jsx|ts|tsx|css|html?|csv)$/i.test(entry.name || '')) {
    return <FileText size={16} />;
  }
  return <File size={16} />;
}

function formatFileSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
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
    if (!rootPath || seen.has(rootPath)) return false;
    seen.add(rootPath);
    return true;
  });
}

function defaultCreateName(kind) {
  return kind === 'directory' ? '新建文件夹' : '未命名.md';
}

export function FilePanel({ project, projects = [] }) {
  // 状态管理 - 对齐 FileManagerPanel
  const [state, setState] = useState({
    loading: false,
    error: '',
    path: '',
    parentPath: '',
    entries: []
  });
  
  const [roots, setRoots] = useState([]);
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
  
  // 面板宽度拖动状态
  const [panelWidth, setPanelWidth] = useState(() => {
    // 从 localStorage 恢复宽度
    const saved = localStorage.getItem('codexmobile.filePanelWidth');
    return saved ? Number(saved) : null; // null 表示使用默认 64%
  });
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef(null);

  const rootsMenuRef = useRef(null);
  const searchInputRef = useRef(null);

  // 当前路径 - 对齐 FileManagerPanel
  const currentPath = state?.path || '';
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  const parentPath = state?.parentPath || '';
  
  // 位置列表 - 对齐 FileManagerPanel
  const projectRootItems = useMemo(() => projectRoots(projects), [projects]);
  const rootItems = useMemo(() => dedupeRoots([
    ...(project?.path ? [{ id: `selected-${project.id}`, label: project.name || '当前项目', path: project.path, project: true }] : []),
    ...projectRootItems,
    ...roots
  ]), [projectRootItems, roots, project]);

  // 搜索过滤 - 对齐 FileManagerPanel
  const normalizedQuery = query.trim().toLowerCase();
  const searchVisible = searchExpanded || Boolean(query);
  
  // 树形行 - 对齐 FileManagerPanel
  const treeRows = useMemo(() => {
    const rows = flattenFileManagerTree({
      entries,
      expandedByPath: treeExpandedByPath,
      childrenByPath: treeChildrenByPath,
      loadingByPath: treeLoadingByPath
    });
    if (!normalizedQuery) return rows;
    return rows.filter((row) => {
      const haystack = `${row.entry.name || ''} ${row.entry.path || ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [entries, normalizedQuery, treeChildrenByPath, treeExpandedByPath, treeLoadingByPath]);

  // 加载目录 - 对齐 FileManagerPanel
  const loadDirectory = useCallback(async (nextPath = '') => {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
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
      setState({
        loading: false,
        error: '',
        path: data.path || nextPath,
        parentPath: data.parentPath || '',
        entries: Array.isArray(data.entries) ? data.entries : []
      });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error?.message || '目录读取失败' }));
    }
  }, []);

  // 刷新当前目录 - 对齐 FileManagerPanel
  async function refreshCurrentTree({ clearSelected = false, selectedEntry = null } = {}) {
    setState((prev) => ({ ...prev, loading: true }));
    
    try {
      const params = new URLSearchParams();
      if (currentPath) {
        params.set('path', currentPath);
      }
      const data = await apiFetch(`/api/files/list?${params.toString()}`);
      setState({
        loading: false,
        error: '',
        path: data.path || currentPath,
        parentPath: data.parentPath || '',
        entries: Array.isArray(data.entries) ? data.entries : []
      });

      // 重新加载展开的目录
      const expandedPaths = Object.keys(treeExpandedByPath).filter((path) => treeExpandedByPath[path]);
      const nextChildrenByPath = {};
      await Promise.all(expandedPaths.map(async (path) => {
        const childParams = new URLSearchParams({ path });
        const childData = await apiFetch(`/api/files/list?${childParams.toString()}`);
        nextChildrenByPath[path] = Array.isArray(childData.entries) ? childData.entries : [];
      }));
      setTreeChildrenByPath((prev) => ({ ...prev, ...nextChildrenByPath }));
      
      if (clearSelected) {
        setSelectedFile(null);
      } else if (selectedEntry?.kind === 'file') {
        setSelectedFile(selectedEntry);
      }
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error?.message || '目录读取失败' }));
    }
  }

  // 加载根目录列表 - 对齐 FileManagerPanel
  useEffect(() => {
    if (!project) return;
    
    let mounted = true;
    async function loadRoots() {
      try {
        const data = await apiFetch('/api/files/roots');
        if (mounted && Array.isArray(data.roots)) {
          setRoots(data.roots.map((root) => ({
            id: `root-${root.path}`,
            label: root.label || root.path,
            path: root.path
          })));
        }
      } catch {
        // 静默失败
      }
    }
    loadRoots();
    return () => { mounted = false; };
  }, [project]);

  // 初始加载项目根目录 - 对齐 FileManagerPanel
  useEffect(() => {
    if (project?.path) {
      loadDirectory(project.path);
    }
  }, [project?.path, loadDirectory]);

  // 点击外部关闭位置菜单
  useEffect(() => {
    if (!rootsMenuOpen) return;
    function handleClick(e) {
      if (rootsMenuRef.current && !rootsMenuRef.current.contains(e.target)) {
        setRootsMenuOpen(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [rootsMenuOpen]);

  // 展开目录 - 对齐 FileManagerPanel
  async function toggleTreeDirectory(entry) {
    const path = entry?.path || '';
    if (!path) return;

    const shouldExpand = !treeExpandedByPath[path];
    setTreeExpandedByPath((prev) => ({ ...prev, [path]: shouldExpand }));

    if (!shouldExpand || treeChildrenByPath[path] || treeLoadingByPath[path]) return;

    setTreeLoadingByPath((prev) => ({ ...prev, [path]: true }));
    try {
      const params = new URLSearchParams({ path });
      const data = await apiFetch(`/api/files/list?${params.toString()}`);
      setTreeChildrenByPath((prev) => ({
        ...prev,
        [path]: sortFileManagerEntries(Array.isArray(data.entries) ? data.entries : [])
      }));
    } catch (error) {
      // 静默失败
    } finally {
      setTreeLoadingByPath((prev) => ({ ...prev, [path]: false }));
    }
  }

  // 选择文件 - 点击文件名选中并预览
  function selectFile(entry) {
    if (entry.kind === 'file') {
      setSelectedFile(entry);
    }
  }

  // 打开条目 - 严格对齐 FileManagerPanel
  function openEntry(entry) {
    const action = fileManagerEntryOpenAction(entry, { desktop: true });
    if (action.type === 'directory') {
      toggleTreeDirectory(entry);
      return;
    }
    if (action.type === 'preview') {
      setDeleteError('');
      // 再次点击同一文件时关闭预览
      if (selectedFile?.path === entry.path) {
        setSelectedFile(null);
      } else {
        setSelectedFile(entry);
      }
      return;
    }
    // 不应该到这里，因为 desktop: true 总是返回 preview
  }

  // 点击整行
  function handleRowClick(entry) {
    openEntry(entry);
  }

  // 点击展开按钮
  function handleTwistClick(entry) {
    if (entry.kind === 'directory') {
      toggleTreeDirectory(entry);
    }
  }

  // 打开位置
  function openRoot(path) {
    setRootsMenuOpen(false);
    setQuery('');
    loadDirectory(path);
  }

  // 返回上级 - 对齐 FileManagerPanel
  function goUp() {
    if (parentPath) {
      loadDirectory(parentPath);
    }
  }

  // 复制路径
  async function handleCopyPath(event, path) {
    event.stopPropagation();
    if (!path) return;
    try {
      await copyTextToClipboard(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath((p) => (p === path ? '' : p)), 1200);
    } catch {
      setDeleteError('复制失败');
    }
  }

  // 重命名
  async function handleRename(event, entry) {
    event.stopPropagation();
    if (!entry?.path || renamingPath) return;
    const name = window.prompt(`重命名${entry.kind === 'directory' ? '文件夹' : '文件'}`, entry.name || '')?.trim();
    if (!name || name === entry.name) return;
    setDeleteError('');
    setRenamingPath(entry.path);
    try {
      const data = await apiFetch('/api/files/rename', {
        method: 'POST',
        body: { path: entry.path, name }
      });
      setQuery('');
      await refreshCurrentTree({ selectedEntry: data.entry });
    } catch (error) {
      setDeleteError(error?.message || '重命名失败');
    } finally {
      setRenamingPath('');
    }
  }

  // 删除文件
  async function handleDelete(event, entry) {
    event.stopPropagation();
    if (!entry?.path || entry.kind === 'directory' || deletingPath) return;
    const confirmed = window.confirm(`删除文件「${entry.name || '未命名文件'}」？`);
    if (!confirmed) return;
    setDeleteError('');
    setDeletingPath(entry.path);
    try {
      await apiFetch(`/api/files/${encodeURIComponent(entry.path)}`, { method: 'DELETE' });
      await refreshCurrentTree({ clearSelected: selectedFile?.path === entry.path });
    } catch (error) {
      setDeleteError(error?.message || '删除失败');
    } finally {
      setDeletingPath('');
    }
  }

  // 新建文件/文件夹
  async function handleCreate(kind) {
    if (!currentPath || creatingKind) return;
    const name = window.prompt(`新建${kind === 'directory' ? '文件夹' : '文件'}名称`, defaultCreateName(kind))?.trim();
    if (!name) return;
    setDeleteError('');
    setCreatingKind(kind);
    try {
      await apiFetch('/api/files/create', {
        method: 'POST',
        body: { path: currentPath, kind, name }
      });
      setQuery('');
      await refreshCurrentTree();
    } catch (error) {
      setDeleteError(error?.message || '创建失败');
    } finally {
      setCreatingKind('');
    }
  }

  // 拖动分割线处理
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    let rafId = null;
    let lastClientX = -1;

    function computeWidth(clientX) {
      if (!panelRef.current) return;
      const drawerWidth = window.matchMedia('(min-width: 1280px)').matches ? 340 : 320;
      const availableWidth = window.innerWidth - drawerWidth;
      const newWidth = availableWidth - (clientX - drawerWidth);
      const minWidth = 200;
      const maxWidth = availableWidth * 0.5;
      return Math.max(minWidth, Math.min(maxWidth, newWidth));
    }

    function handleMouseMove(e) {
      lastClientX = e.clientX;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const clampedWidth = computeWidth(lastClientX);
        if (clampedWidth !== undefined) {
          setPanelWidth(clampedWidth);
        }
      });
    }

    function handleMouseUp() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (lastClientX >= 0) {
        const clampedWidth = computeWidth(lastClientX);
        if (clampedWidth !== undefined) {
          setPanelWidth(clampedWidth);
          localStorage.setItem('codexmobile.filePanelWidth', String(clampedWidth));
        }
      }
      setIsDragging(false);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 计算面板宽度
  const computedWidth = panelWidth || null;
  const widthStyle = panelWidth ? `${panelWidth}px` : undefined;
  
  // 更新 CSS 变量
  useEffect(() => {
    if (panelWidth) {
      document.documentElement.style.setProperty('--file-panel-width', `${panelWidth}px`);
    } else {
      document.documentElement.style.removeProperty('--file-panel-width');
    }
  }, [panelWidth]);

  if (!project) {
    return (
      <aside className="file-panel">
        <div className="file-panel-empty">
          <FileText size={24} />
          <span>选择项目</span>
        </div>
      </aside>
    );
  }

  return (
    <aside 
      ref={panelRef}
      className={`file-panel ${isDragging ? 'is-dragging' : ''}`}
      style={widthStyle ? { width: widthStyle } : undefined}
    >
      {/* 拖动分割线 */}
      <div
        className="file-panel-resize-handle"
        onMouseDown={handleMouseDown}
      />
      
      {/* 上部：文件预览区 - 严格对齐 FileManagerPanel */}
      <div className="file-panel-preview">
        {selectedFile?.path ? (
          <iframe
            className="file-panel-preview-frame"
            src={localFilePreviewPath(selectedFile.path, { embed: true })}
            title={`预览 ${selectedFile.name || '文件'}`}
          />
        ) : (
          <div className="file-panel-preview-empty">
            <FileText size={30} />
            <strong>选择一个文件</strong>
          </div>
        )}
      </div>

      {/* 下部：文件选择区 */}
      <div className="file-panel-tree">
        {/* 工具栏 */}
        <div className="file-panel-toolbar">
          {/* 位置选择器 */}
          <div className="file-panel-roots" ref={rootsMenuRef}>
            <button
              type="button"
              className="file-panel-roots-button"
              onClick={() => setRootsMenuOpen((v) => !v)}
              aria-expanded={rootsMenuOpen}
            >
              <MapPinned size={14} />
              <span>位置</span>
              <ChevronDown size={12} />
            </button>
            {rootsMenuOpen ? (
              <div className="file-panel-roots-popover" role="menu">
                {rootItems.map((root) => (
                  <button
                    key={`${root.id}-${root.path}`}
                    type="button"
                    onClick={() => openRoot(root.path)}
                    role="menuitem"
                  >
                    {root.id === 'home' ? <Home size={14} /> : root.project ? <FolderOpen size={14} /> : <HardDrive size={14} />}
                    <span>{root.label}</span>
                    <small>{compactPath(root.path)}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* 返回上级 - 放在位置右侧 */}
          <button
            type="button"
            className="file-panel-action"
            onClick={goUp}
            disabled={!parentPath || state.loading}
            title="返回上级"
          >
            <ArrowUp size={14} />
          </button>

          {/* 操作按钮 */}
          <div className="file-panel-actions">
            <button type="button" className="file-panel-action" onClick={() => refreshCurrentTree()} disabled={state.loading} title="刷新">
              {state.loading ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
            </button>
            <button type="button" className="file-panel-action" onClick={() => handleCreate('file')} disabled={state.loading || creatingKind} title="新建文件">
              {creatingKind === 'file' ? <Loader2 className="spin" size={14} /> : <FilePlus size={14} />}
            </button>
            <button type="button" className="file-panel-action" onClick={() => handleCreate('directory')} disabled={state.loading || creatingKind} title="新建文件夹">
              {creatingKind === 'directory' ? <Loader2 className="spin" size={14} /> : <FolderPlus size={14} />}
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="file-panel-search">
          <Search size={14} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="搜索文件..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* 错误提示 */}
        {deleteError ? (
          <div className="file-panel-error">{deleteError}</div>
        ) : null}

        {/* 文件树 */}
        <div className="file-panel-tree-content" role="tree">
          {state.loading && treeRows.length === 0 ? (
            <div className="file-panel-tree-status">
              <Loader2 className="spin" size={14} />
              <span>加载中...</span>
            </div>
          ) : state.error ? (
            <div className="file-panel-tree-error">{state.error}</div>
          ) : treeRows.length === 0 ? (
            <div className="file-panel-tree-status">{query ? '无匹配结果' : '空目录'}</div>
          ) : (
            treeRows.map((row) => (
              <div
                key={row.entry.path}
                className={`file-panel-tree-row ${selectedFile?.path === row.entry.path ? 'is-selected' : ''}`}
                style={{ '--tree-depth': row.depth }}
                onClick={() => handleRowClick(row.entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleRowClick(row.entry);
                  }
                }}
                role="treeitem"
                tabIndex={0}
              >
                <span
                  className="file-panel-tree-twist"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTwistClick(row.entry);
                  }}
                >
                  {row.loading ? (
                    <Loader2 className="spin" size={12} />
                  ) : row.expandable ? (
                    row.expanded ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )
                  ) : null}
                </span>
                <span className={`file-panel-tree-icon is-${row.entry.kind}`}>
                  {entryIcon(row.entry, row.expanded)}
                </span>
                <span className="file-panel-tree-name">{row.entry.name}</span>
                
                {/* 快捷操作 */}
                <div className="file-panel-tree-actions">
                  <button
                    type="button"
                    className="file-panel-tree-action"
                    onClick={(e) => handleCopyPath(e, row.entry.path)}
                    title="复制路径"
                  >
                    {copiedPath === row.entry.path ? <span style={{ color: 'var(--accent)' }}>✓</span> : <Copy size={12} />}
                  </button>
                  <button
                    type="button"
                    className="file-panel-tree-action"
                    onClick={(e) => handleRename(e, row.entry)}
                    disabled={renamingPath === row.entry.path}
                    title="重命名"
                  >
                    {renamingPath === row.entry.path ? <Loader2 className="spin" size={12} /> : <Pencil size={12} />}
                  </button>
                  {row.entry.kind !== 'directory' ? (
                    <button
                      type="button"
                      className="file-panel-tree-action is-delete"
                      onClick={(e) => handleDelete(e, row.entry)}
                      disabled={deletingPath === row.entry.path}
                      title="删除"
                    >
                      {deletingPath === row.entry.path ? <Loader2 className="spin" size={12} /> : <Trash2 size={12} />}
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
