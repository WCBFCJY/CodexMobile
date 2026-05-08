export const MAX_MOBILE_GIT_FILES = 500;

export function gitChangedFileCount(status = {}) {
  if (Number.isFinite(status.fileCount)) {
    return status.fileCount;
  }
  return Array.isArray(status.files) ? status.files.length : 0;
}

export function gitSafetyWarnings(status = {}) {
  const warnings = [];
  const fileCount = gitChangedFileCount(status);
  if (fileCount) {
    warnings.push(`工作区有 ${fileCount} 个改动文件`);
  }
  if (status.filesTruncated) {
    warnings.push(`仅显示前 ${Array.isArray(status.files) ? status.files.length : MAX_MOBILE_GIT_FILES} 个文件`);
  }
  if (status.behind > 0) {
    warnings.push(`落后远端 ${status.behind} 个提交`);
  }
  if (status.branch && !String(status.branch).startsWith('codex/')) {
    warnings.push('当前不是 codex/ 分支');
  }
  if (status.branch && !status.upstream) {
    warnings.push('当前分支没有 upstream');
  }
  return warnings;
}

export function gitActionBlockReason(status = {}, action = '') {
  if (!status?.branch) {
    return '当前不在有效 Git 分支上';
  }
  if (!String(status.branch).startsWith('codex/')) {
    return '移动端只允许在 codex/ 分支执行提交或推送';
  }
  if (status.filesTruncated || gitChangedFileCount(status) > MAX_MOBILE_GIT_FILES) {
    return '改动文件过多，请先在桌面端确认范围';
  }
  if ((action === 'commit' || action === 'commit-push') && !status.canCommit) {
    return '没有可提交的改动';
  }
  return '';
}
