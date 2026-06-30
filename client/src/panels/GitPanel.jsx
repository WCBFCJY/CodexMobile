/**
 * Git 操作侧栏：分支 / 提交 / 推送 / PR 草稿等与后端 Git API 对接的移动端面板。
 *
 * Keywords: git, branch, commit, push, diff, worktree
 *
 * Exports:
 * - GitPanel — Git 面板组件。
 *
 * Inward: apiFetch、git-panel-actions、git-panel-state、clipboard；lucide-react。
 *
 * Outward: App / TopBar 在打开 Git 抽屉时使用。
 */

import { Check, ChevronDown, Copy, ExternalLink, FileText, FolderGit2, GitBranch, GitCommitHorizontal, GitPullRequest, ListTree, Loader2, MoreHorizontal, Plus, RefreshCw, UploadCloud, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import { gitActionRequestConfig } from '../git-panel-actions.js';
import { gitActionBlockReason, gitChangedFileCount, gitSafetyWarnings } from '../git-panel-state.js';
import { copyTextToClipboard } from '../utils/clipboard.js';

function gitActionTitle(action) {
  const titles = {
    branches: 'Git 分支',
    branch: '创建分支',
    status: 'Git 状态',
    diff: 'Git Diff',
    actions: 'Git 操作',
    pull: '拉取',
    sync: '同步',
    commit: '提交',
    push: '推送',
    'commit-push': '提交并推送',
    'pr-draft': 'PR 草稿',
    worktree: '新建 Worktree'
  };
  return titles[action] || 'Git';
}

function gitBranchDraft(project) {
  const name = String(project?.name || 'changes')
    .trim()
    .toLowerCase()
    .replace(/^codex\//, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return `codex/${name || 'changes'}`;
}

// 把 unified diff 文本解析成按文件分组的结构化数据
function parseDiffPatch(patch) {
  if (!patch) return [];
  const lines = patch.split('\n');
  const files = [];
  let current = null;
  let hunkLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      if (current) {
        current.hunks.push({ lines: hunkLines });
        hunkLines = [];
      }
      current = { header: line, hunks: [] };
      files.push(current);
    } else if (line.startsWith('@@')) {
      if (current && hunkLines.length) {
        current.hunks.push({ lines: hunkLines });
        hunkLines = [];
      }
      hunkLines.push({ type: 'hunk', text: line });
    } else if (current) {
      let type = 'context';
      if (line.startsWith('+')) type = 'add';
      else if (line.startsWith('-')) type = 'del';
      else if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) type = 'meta';
      if (type === 'meta') continue;
      hunkLines.push({ type, text: line });
    }
  }
  if (current && hunkLines.length) {
    current.hunks.push({ lines: hunkLines });
  }
  return files;
}

function diffFileName(header) {
  const match = header.match(/^diff --git a\/(\S+) b\/(\S+)/);
  return match ? match[2] : header;
}

export function GitPanel({ open, action, project, onClose, onToast }) {
  const projectId = project?.id || '';
  const [panelAction, setPanelAction] = useState(action || 'status');
  const [status, setStatus] = useState(null);
  const [branches, setBranches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [diff, setDiff] = useState(null);
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [copiedDraft, setCopiedDraft] = useState(false);

  const activeAction = panelAction || action || 'status';
  const title = gitActionTitle(activeAction);
  const fileCount = gitChangedFileCount(status || {});
  const safetyWarnings = gitSafetyWarnings(status || {});
  const blockReason = status ? gitActionBlockReason(status, activeAction) : '';
  const branchList = Array.isArray(branches?.branches) ? branches.branches : [];
  const branchControlsLimited = Boolean(branches?.limited);
  const defaultBaseBranch = branches?.defaultBranch || baseBranch || 'main';
  const prDraft = result?.draft || (activeAction === 'pr-draft' ? result : null);

  const loadStatus = useCallback(async () => {
    if (!open || !projectId) return null;
    const data = await apiFetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`);
    const nextStatus = data.status || null;
    setStatus(nextStatus);
    setCommitMessage((current) => current || nextStatus?.defaultCommitMessage || '');
    return nextStatus;
  }, [open, projectId]);

  const loadBranches = useCallback(async () => {
    if (!open || !projectId) return null;
    try {
      const data = await apiFetch(`/api/git/branches?projectId=${encodeURIComponent(projectId)}`);
      const nextBranches = data.branches || null;
      setBranches(nextBranches);
      setBaseBranch((current) => current || nextBranches?.defaultBranch || 'main');
      setBranchName((current) => current || gitBranchDraft(project));
      return nextBranches;
    } catch (loadError) {
      if (loadError.status !== 404) {
        throw loadError;
      }
      const nextStatus = status || (await loadStatus());
      const currentBranch = nextStatus?.branch || '';
      const fallbackBranches = {
        current: currentBranch,
        defaultBranch: 'main',
        limited: true,
        branches: currentBranch
          ? [{ name: currentBranch, current: true, default: currentBranch === 'main', upstream: nextStatus?.upstream || null }]
          : []
      };
      setBranches(fallbackBranches);
      setBaseBranch((current) => current || 'main');
      setBranchName((current) => current || gitBranchDraft(project));
      return fallbackBranches;
    }
  }, [open, projectId, project, status, loadStatus]);

  const loadDiff = useCallback(async () => {
    if (!open || !projectId) return;
    setBusy(true);
    setBusyAction('diff');
    setError('');
    try {
      const data = await apiFetch(`/api/git/diff?projectId=${encodeURIComponent(projectId)}`);
      setDiff(data.diff || null);
      if (data.diff?.status) setStatus(data.diff.status);
    } catch (loadError) {
      setError(loadError.message || '读取 Git diff 失败');
    } finally {
      setDiffLoaded(true);
      setBusy(false);
      setBusyAction('');
    }
  }, [open, projectId]);

  const refreshAll = useCallback(async () => {
    if (!open || !projectId) return;
    setError('');
    try {
      await Promise.all([loadStatus(), loadBranches()]);
    } catch (loadError) {
      setError(loadError.message || '读取 Git 状态失败');
    }
  }, [open, projectId, loadStatus, loadBranches]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setDiff(null);
    setDiffLoaded(false);
    setError('');
    setCopiedDraft(false);
    setCommitMessage('');
    setBranchName('');
    setBaseBranch('');
    setPanelAction(action || 'status');
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action, projectId]);

  useEffect(() => {
    if (open && activeAction === 'diff' && !diffLoaded && !busy) {
      loadDiff();
    }
  }, [open, activeAction, diffLoaded, busy, loadDiff]);

  function selectPanelAction(nextAction) {
    setPanelAction(nextAction);
    setError('');
    setResult(null);
  }

  async function runGitAction(nextAction = activeAction, extraBody = {}) {
    if (!projectId || busy) return;
    if (!status && (nextAction === 'commit' || nextAction === 'commit-push' || nextAction === 'pull' || nextAction === 'push' || nextAction === 'sync')) {
      setError('Git 状态尚未读取完成');
      return;
    }
    const nextBlockReason = status ? gitActionBlockReason(status, nextAction) : '';
    if ((nextAction === 'commit' || nextAction === 'commit-push' || nextAction === 'push' || nextAction === 'sync') && nextBlockReason) {
      setError(nextBlockReason);
      onToast?.({ level: 'warning', title: gitActionTitle(nextAction), body: nextBlockReason });
      return;
    }
    setBusy(true);
    setBusyAction(nextAction);
    setError('');
    setResult(null);
    onToast?.({ level: 'info', title: gitActionTitle(nextAction), body: '正在执行 Git 操作...' });
    try {
      const data = await requestGitAction(nextAction, extraBody);
      setResult(data || {});
      if (data?.status) setStatus(data.status);
      if (data?.branches) setBranches(data.branches);
      if (data?.draft?.status) setStatus(data.draft.status);
      if (data?.status?.defaultCommitMessage) setCommitMessage(data.status.defaultCommitMessage);
      onToast?.({ level: 'success', title: gitActionTitle(nextAction), body: 'Git 操作已完成' });
    } catch (runError) {
      setError(runError.message || 'Git 操作失败');
      onToast?.({ level: 'error', title: gitActionTitle(nextAction), body: runError.message || 'Git 操作失败' });
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  }

  async function requestGitAction(nextAction, extraBody) {
    const request = gitActionRequestConfig(nextAction, {
      projectId,
      commitMessage,
      branchName,
      baseBranch,
      defaultBaseBranch,
      extraBody
    });
    return request ? apiFetch(request.path, request.options) : null;
  }

  async function copyDraft() {
    if (!prDraft) return;
    const copied = await copyTextToClipboard(`# ${prDraft.title}\n\n${prDraft.body}`);
    setCopiedDraft(copied);
    if (!copied) window.alert('复制失败');
  }

  const canCommit = Boolean(status?.canCommit && commitMessage.trim() && !blockReason);
  const canPush = Boolean(status?.branch && !blockReason);
  const canCreateBranch = Boolean(branchName.trim());
  const canCreateWorktree = Boolean(branchName.trim() && (baseBranch || defaultBaseBranch));

  if (!open) return null;

  return (
    <section className="docs-panel git-panel git-action-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <header className="docs-panel-header">
        <span className="docs-panel-spacer" aria-hidden="true" />
        <div className="docs-panel-title">
          <strong>{title}</strong>
          <span>{status?.branch || project?.name || 'Git'}</span>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭 Git">
          <X size={20} />
        </button>
      </header>

      <div className="docs-panel-body git-panel-body">
        <GitStatusSummary status={status} fileCount={fileCount} warnings={safetyWarnings} onRefresh={refreshAll} busy={busy} />
        <GitActionLauncher activeAction={activeAction} onSelect={selectPanelAction} disabled={busy} />

        {activeAction === 'status' ? (
          <StatusFileList status={status} />
        ) : null}

        {activeAction === 'diff' ? (
          <DiffSheet diff={diff} busy={busyAction === 'diff'} onRefresh={loadDiff} />
        ) : null}

        {activeAction === 'actions' ? (
          <ActionsSheet
            branches={branchList}
            branchName={branchName}
            setBranchName={setBranchName}
            busy={busy}
            busyAction={busyAction}
            onCheckout={(branch) => runGitAction('checkout', { branch })}
            onCreateBranch={() => runGitAction('branch')}
            onCreateWorktree={() => runGitAction('worktree')}
            canCreateBranch={canCreateBranch}
            canCreateWorktree={canCreateWorktree && !branchControlsLimited}
            limited={branchControlsLimited}
            commitMessage={commitMessage}
            setCommitMessage={setCommitMessage}
            canCommit={canCommit}
            onCommit={(action) => runGitAction(action)}
            blockReason={blockReason}
            result={result}
            onRun={(action) => runGitAction(action)}
            baseBranch={baseBranch || defaultBaseBranch}
            setBaseBranch={setBaseBranch}
            draft={prDraft}
            canGenerate={canPush}
            copied={copiedDraft}
            onGenerate={() => runGitAction('pr-draft')}
            onCopy={copyDraft}
          />
        ) : null}

        {error ? <div className="docs-panel-error">{error}</div> : null}
        <GitResult result={result} action={activeAction} />
      </div>
    </section>
  );
}

function GitActionLauncher({ activeAction, onSelect, disabled }) {
  const tabs = [
    ['status', ListTree, '状态'],
    ['diff', FileText, 'Diff'],
    ['actions', MoreHorizontal, '操作']
  ];
  return (
    <nav className="git-action-launcher" aria-label="Git 操作">
      {tabs.map(([nextAction, Icon, label]) => (
        <button
          key={nextAction}
          type="button"
          className={activeAction === nextAction ? 'is-active' : ''}
          onClick={() => onSelect(nextAction)}
          disabled={disabled && activeAction !== nextAction}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function ActionsSheet(props) {
  const { busy } = props;

  return (
    <section className="git-actions-page">
      <RemoteActionsSheet busy={busy} result={props.result} blockReason={props.blockReason} onRun={props.onRun} />
      <CommitSheet
        action="commit"
        commitMessage={props.commitMessage}
        setCommitMessage={props.setCommitMessage}
        canCommit={props.canCommit}
        busy={busy}
        busyAction={props.busyAction}
        onCommit={() => props.onCommit('commit')}
        onCommitPush={() => props.onCommit('commit-push')}
        blockReason={props.blockReason}
      />
      <BranchSheet
        branches={props.branches}
        branchName={props.branchName}
        setBranchName={props.setBranchName}
        busy={busy}
        busyAction={props.busyAction}
        onCheckout={props.onCheckout}
        onCreateBranch={props.onCreateBranch}
        onCreateWorktree={props.onCreateWorktree}
        canCreateBranch={props.canCreateBranch}
        canCreateWorktree={props.canCreateWorktree}
        limited={props.limited}
      />
    </section>
  );
}

function RemoteActionsSheet({ busy, result, blockReason, onRun }) {
  const items = [
    ['pull', RefreshCw, '拉取'],
    ['sync', RefreshCw, '同步'],
    ['push', UploadCloud, '推送']
  ];
  return (
    <section className="git-action-card">
      <div className="git-section-head">
        <strong>Git 操作</strong>
        <span>{busy ? '正在执行...' : result ? '已完成' : '准备执行'}</span>
      </div>
      {busy ? <div className="git-inline-progress"><Loader2 className="spin" size={16} /> 正在处理 Git 操作</div> : null}
      {!busy ? (
        <div className="git-action-grid git-action-grid-3">
          {items.map(([action, Icon, label]) => (
            <button key={action} type="button" onClick={() => onRun(action)} disabled={Boolean(blockReason)}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {blockReason ? <small className="git-diff-note">{blockReason}</small> : null}
    </section>
  );
}

function StatusFileList({ status }) {
  const files = Array.isArray(status?.files) ? status.files : [];
  return (
    <section className="git-action-card">
      <div className="git-section-head">
        <strong>状态</strong>
        <span>{status?.clean ? '暂无改动' : `${status?.fileCount || files.length} 个改动文件`}</span>
      </div>
      {files.length ? (
        <div className="git-file-list">
          {files.map((file) => (
            <div key={`${file.status}:${file.path}`}>
              <code>{file.status}</code>
              <span>{file.path}</span>
            </div>
          ))}
        </div>
      ) : <p className="git-help-text">工作区当前没有可展示的改动文件。</p>}
      {status?.filesTruncated ? <small className="git-diff-note">status 仅展示部分文件，Git 操作仍按真实工作区执行。</small> : null}
    </section>
  );
}

function GitStatusSummary({ status, fileCount, warnings, onRefresh, busy }) {
  return (
    <section className="git-status-card is-compact">
      <div className="git-status-head">
        <div>
          <strong>{status?.clean ? '工作区干净' : '当前改动'}</strong>
          <span>{status?.branch || '未读取'}{status?.upstream ? ` -> ${status.upstream}` : ''}</span>
        </div>
        <button type="button" className="icon-button" onClick={onRefresh} disabled={busy} aria-label="刷新 Git 状态">
          <RefreshCw size={18} />
        </button>
      </div>
      <div className="git-status-metrics">
        <span>{fileCount} 文件</span>
        <span>ahead {status?.ahead || 0}</span>
        <span>behind {status?.behind || 0}</span>
      </div>
      {warnings.length ? (
        <div className="git-safety-list">
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
    </section>
  );
}

function BranchSheet({ branches, branchName, setBranchName, busy, busyAction, onCheckout, onCreateBranch, onCreateWorktree, canCreateBranch, canCreateWorktree, limited = false }) {
  return (
    <section className="git-action-card">
      <div className="git-section-head">
        <strong>分支</strong>
        <span>切换或创建 `codex/` 分支</span>
      </div>
      <div className="git-branch-list">
        {branches.map((branch) => (
          <button
            key={branch.name}
            type="button"
            disabled={busy || limited || branch.current || branch.checkedOutElsewhere}
            onClick={() => onCheckout(branch.name)}
          >
            <GitBranch size={15} />
            <span>
              <strong>{branch.name}</strong>
              <small>{branch.current ? '当前分支' : branch.checkedOutElsewhere ? `已在 ${branch.worktreePath}` : branch.default ? '默认分支' : branch.upstream || '本地分支'}</small>
            </span>
          </button>
        ))}
      </div>
      <label className="git-field">
        <span>新分支名</span>
        <input value={branchName} onChange={(event) => setBranchName(event.target.value)} />
      </label>
      <div className="git-action-grid">
        <button type="button" onClick={onCreateBranch} disabled={busy || !canCreateBranch}>
          {busyAction === 'branch' ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}
          创建并切换
        </button>
        <button type="button" onClick={onCreateWorktree} disabled={busy || !canCreateWorktree}>
          {busyAction === 'worktree' ? <Loader2 className="spin" size={15} /> : <FolderGit2 size={15} />}
          新建 worktree
        </button>
      </div>
      {limited ? <p className="git-help-text">当前后端只提供基础 Git 操作，分支切换和 worktree 暂不可用。</p> : null}
    </section>
  );
}

function CreateBranchSheet({ branchName, setBranchName, busy, busyAction, onCreateBranch, canCreateBranch }) {
  return (
    <section className="git-action-card">
      <label className="git-field">
        <span>分支名</span>
        <input value={branchName} onChange={(event) => setBranchName(event.target.value)} />
      </label>
      <div className="git-action-grid">
        <button type="button" onClick={onCreateBranch} disabled={busy || !canCreateBranch}>
          {busyAction === 'branch' ? <Loader2 className="spin" size={15} /> : <GitBranch size={15} />}
          创建分支
        </button>
      </div>
    </section>
  );
}

function DiffSheet({ diff, busy, onRefresh }) {
  const files = useMemo(() => parseDiffPatch(diff?.patch), [diff?.patch]);
  const summaryStats = useMemo(() => {
    if (!diff?.summary) return null;
    const lines = diff.summary.split('\n').filter(Boolean);
    const last = lines[lines.length - 1] || '';
    const fileMatch = last.match(/(\d+)\s+files?\s+changed/);
    const addMatch = last.match(/(\d+)\s+insertions?\(\+\)/);
    const delMatch = last.match(/(\d+)\s+deletions?\(-\)/);
    return {
      files: fileMatch ? fileMatch[1] : null,
      adds: addMatch ? addMatch[1] : null,
      dels: delMatch ? delMatch[1] : null,
      raw: last
    };
  }, [diff?.summary]);

  return (
    <section className="git-diff-card">
      <div className="git-section-head">
        <strong>Diff 预览</strong>
        <button type="button" onClick={onRefresh} disabled={busy}>
          {busy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
          刷新
        </button>
      </div>
      {summaryStats ? (
        <div className="git-diff-summary-bar">
          {summaryStats.files ? <span className="git-diff-stat-files">{summaryStats.files} 文件</span> : null}
          {summaryStats.adds ? <span className="git-diff-stat-add">+{summaryStats.adds}</span> : null}
          {summaryStats.dels ? <span className="git-diff-stat-del">-{summaryStats.dels}</span> : null}
        </div>
      ) : null}
      {busy && !diff?.patch ? (
        <div className="git-diff-empty">正在读取 diff...</div>
      ) : files.length ? (
        <div className="git-diff-files">
          {files.map((file, fi) => (
            <DiffFileBlock key={fi} file={file} />
          ))}
        </div>
      ) : (
        <div className="git-diff-empty">暂无 diff</div>
      )}
      {diff?.truncated ? <small className="git-diff-note">diff 太长，已截断显示。</small> : null}
    </section>
  );
}

function DiffFileBlock({ file }) {
  const [collapsed, setCollapsed] = useState(false);
  let addCount = 0;
  let delCount = 0;
  file.hunks.forEach((hunk) => hunk.lines.forEach((row) => {
    if (row.type === 'add') addCount += 1;
    if (row.type === 'del') delCount += 1;
  }));

  return (
    <div className="git-diff-file">
      <div className="git-diff-file-head" onClick={() => setCollapsed((v) => !v)} role="button" tabIndex={0}>
        <ChevronDown size={14} className={collapsed ? 'git-diff-chevron-collapsed' : ''} />
        <FileText size={14} />
        <span className="git-diff-file-name">{diffFileName(file.header)}</span>
        <span className="git-diff-file-stats">
          <span className="git-diff-add-count">+{addCount}</span>
          <span className="git-diff-del-count">-{delCount}</span>
        </span>
      </div>
      {!collapsed ? (
        <div className="git-diff-body">
          {file.hunks.map((hunk, hi) => (
            <div key={hi} className="git-diff-hunk">
              {hunk.lines.map((row, ri) => (
                <div key={ri} className={`git-diff-row git-diff-${row.type}`}>
                  <span className="git-diff-sign">
                    {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
                  </span>
                  <span className="git-diff-text">{row.text.replace(/^[+\-\s]/, '')}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CommitSheet({ action, commitMessage, setCommitMessage, canCommit, busy, busyAction, onCommit, onCommitPush, blockReason }) {
  return (
    <section className="git-action-card">
      <label className="git-field">
        <span>提交信息</span>
        <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
      </label>
      <div className="git-action-grid git-action-grid-2">
        <button type="button" onClick={onCommit} disabled={busy || !canCommit}>
          {busyAction === 'commit' ? <Loader2 className="spin" size={15} /> : <GitCommitHorizontal size={15} />}
          提交
        </button>
        <button type="button" onClick={onCommitPush} disabled={busy || !canCommit}>
          {busyAction === 'commit-push' ? <Loader2 className="spin" size={15} /> : <UploadCloud size={15} />}
          提交并推送
        </button>
      </div>
      {blockReason ? <small className="git-diff-note">{blockReason}</small> : null}
    </section>
  );
}

function ActionProgress({ action, busy, result, blockReason, onRun }) {
  return (
    <section className="git-action-card">
      <div className="git-section-head">
        <strong>{gitActionTitle(action)}</strong>
        <span>{busy ? '正在执行...' : result ? '已完成' : '准备执行'}</span>
      </div>
      {busy ? <div className="git-inline-progress"><Loader2 className="spin" size={16} /> 正在处理 Git 操作</div> : null}
      {!busy && !result ? (
        <div className="git-action-grid">
          <button type="button" onClick={onRun} disabled={Boolean(blockReason)}>
            {action === 'push' ? <UploadCloud size={15} /> : <RefreshCw size={15} />}
            开始{gitActionTitle(action)}
          </button>
        </div>
      ) : null}
      {blockReason ? <small className="git-diff-note">{blockReason}</small> : null}
    </section>
  );
}

function PrDraftSheet({ baseBranch, setBaseBranch, busy, draft, canGenerate, copied, onGenerate, onCopy }) {
  return (
    <section className="git-action-card">
      <label className="git-field">
        <span>Base branch</span>
        <input value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} />
      </label>
      <div className="git-action-grid">
        <button type="button" onClick={onGenerate} disabled={busy || !canGenerate}>
          {busy ? <Loader2 className="spin" size={15} /> : <GitPullRequest size={15} />}
          生成 PR 草稿
        </button>
      </div>
      {draft ? (
        <div className="git-pr-draft">
          <strong>{draft.title}</strong>
          {draft.needsPush ? <small>当前分支需要先 push，再打开 PR。</small> : null}
          <pre>{draft.body}</pre>
          <div className="git-action-grid">
            <button type="button" onClick={onCopy}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? '已复制' : '复制正文'}
            </button>
            <button type="button" onClick={() => window.open(draft.compareUrl, '_blank', 'noopener,noreferrer')}>
              <ExternalLink size={15} />
              打开 Compare
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function GitResult({ result, action }) {
  const message = useMemo(() => {
    if (!result) return '';
    if (result.hash) return `已提交 ${result.hash}`;
    if (result.branch) return `已更新 ${result.branch}`;
    if (result.pushed?.branch) return `已推送 ${result.pushed.branch}`;
    if (result.worktreePath) return `已创建 worktree: ${result.worktreePath}`;
    if (result.draft) return 'PR 草稿已生成';
    return action ? `${gitActionTitle(action)}已完成` : 'Git 操作已完成';
  }, [result, action]);

  if (!result || !message) return null;
  return (
    <>
      <div className="git-result">
        <Check size={17} />
        <span>{message}</span>
      </div>
      {result.output ? <pre className="git-output">{result.output}</pre> : null}
    </>
  );
}
