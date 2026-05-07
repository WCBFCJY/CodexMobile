import assert from 'node:assert/strict';
import test from 'node:test';
import { appReducer, createInitialUiState } from './app/AppState.js';
import { applyPwaTheme } from './app/pwa-theme.js';
import { createDraftSession, resolveNewConversationProject, sessionRunBadgeState, shouldPreserveLocalRunsFromStatus, titleFromFirstMessage } from './app/session-utils.js';
import { runtimeKeysForPayload } from './app/useTurnRuntime.js';
import { viewportSizingMetrics } from './app/useViewportSizing.js';

test('appReducer updates ui state with direct and functional values', () => {
  const initial = createInitialUiState({ storage: { getItem: () => 'light' } });
  const opened = appReducer(initial, { type: 'ui/drawerOpen', value: true });
  assert.equal(opened.drawerOpen, true);

  const nextGit = appReducer(opened, {
    type: 'ui/gitPanel',
    value: (current) => ({ ...current, open: true, action: 'sync' })
  });
  assert.deepEqual(nextGit.gitPanel, { open: true, action: 'sync' });
});

test('createInitialUiState restores dark theme from storage', () => {
  const state = createInitialUiState({ storage: { getItem: () => 'dark' } });
  assert.equal(state.theme, 'dark');
});

test('applyPwaTheme syncs iOS PWA meta with dark theme', () => {
  const elements = new Map([
    ['meta[data-app-theme-color]', { content: '', setAttribute(name, value) { this[name] = value; } }],
    ['meta[data-app-status-bar-style]', { content: '', setAttribute(name, value) { this[name] = value; } }]
  ]);
  const doc = {
    documentElement: { dataset: {} },
    querySelector(selector) {
      return elements.get(selector);
    }
  };

  const meta = applyPwaTheme('dark', doc);

  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(meta.themeColor, '#000000');
  assert.equal(elements.get('meta[data-app-theme-color]').content, '#000000');
  assert.equal(elements.get('meta[data-app-status-bar-style]').content, 'black-translucent');
});

test('status sync preserves local desktop-ipc pending runs', () => {
  assert.equal(
    shouldPreserveLocalRunsFromStatus({ desktopIpcPendingRunCount: 1 }),
    true
  );
  assert.equal(
    shouldPreserveLocalRunsFromStatus({
      activePollCount: 0,
      turnRefreshTimerCount: 0,
      desktopIpcPendingRunCount: 0
    }),
    false
  );
});

test('new conversation project resolution prefers explicit drawer choice', () => {
  const normal = { id: '__codexmobile_projectless__', projectless: true, name: '普通对话' };
  const codexMobile = { id: 'project-codexmobile', name: 'CodexMobile' };
  const selected = { id: 'project-other', name: 'Other' };

  assert.equal(resolveNewConversationProject(codexMobile, selected, [normal, codexMobile]), codexMobile);
  assert.equal(resolveNewConversationProject(null, null, [normal, codexMobile]), normal);
});

test('draft sessions preserve the chosen conversation scope', () => {
  const normal = { id: '__codexmobile_projectless__', projectless: true, name: '普通对话' };
  const draft = createDraftSession(normal);

  assert.equal(draft.projectId, normal.id);
  assert.equal(draft.draft, true);
  assert.match(draft.id, /^draft-__codexmobile_projectless__-/);
});

test('titleFromFirstMessage uses the shared provisional title helper', () => {
  assert.equal(titleFromFirstMessage('帮我看一下移动端新对话逻辑'), '移动端新对话逻辑');
});

test('sessionRunBadgeState prefers explicit running runtime', () => {
  const session = {
    id: 'thread-1',
    runtime: { status: 'running', turnId: 'turn-1', updatedAt: '2026-05-08T02:00:00.000Z' }
  };

  assert.equal(sessionRunBadgeState(session), 'running');
});

test('sessionRunBadgeState reads active runs by session id', () => {
  const session = { id: 'thread-2' };

  assert.equal(
    sessionRunBadgeState(session, { runningById: { 'thread-2': true } }),
    'running'
  );
});

test('completed turn payload maps back to the selected sidebar session', () => {
  const session = { id: 'thread-3', projectId: 'projectA', turnId: 'turn-3' };
  const keys = runtimeKeysForPayload(
    { type: 'status-update', kind: 'turn', status: 'completed', turnId: 'turn-3' },
    session
  );

  assert.deepEqual(keys, ['turn-3', 'thread-3']);
  assert.equal(
    sessionRunBadgeState(session, {
      threadRuntimeById: {
        'thread-3': { status: 'completed', updatedAt: '2026-05-08T02:10:00.000Z' }
      },
      completedSessionIds: { 'thread-3': true }
    }),
    'complete'
  );
});

test('viewportSizingMetrics exposes keyboard inset from visual viewport', () => {
  const metrics = viewportSizingMetrics({
    visualViewport: { height: 520, width: 390, offsetTop: 0 },
    innerHeight: 844,
    innerWidth: 390,
    clientHeight: 844
  });

  assert.equal(metrics.keyboardOpen, true);
  assert.equal(metrics.keyboardInset, 324);
  assert.equal(metrics.height, 520);
});
