import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displayMessageForTurn,
  prepareComposerSubmission,
  projectForTurnSelection,
  realSessionIdFromTurn,
  restoredComposerText,
  sessionForTurnSelection,
  selectedSkillsForPaths,
  turnMatchesSelection
} from './app/turn-submission-utils.js';

test('realSessionIdFromTurn ignores draft and codex placeholder sessions', () => {
  assert.equal(realSessionIdFromTurn({ sessionId: 'thread-1' }), 'thread-1');
  assert.equal(realSessionIdFromTurn({ sessionId: 'draft-project-1' }), null);
  assert.equal(realSessionIdFromTurn({ sessionId: 'codex-local-1' }), null);
  assert.equal(realSessionIdFromTurn({ sessionId: '' }), null);
});

test('turnMatchesSelection accepts optimistic, real, previous, turn, and draft matches', () => {
  const ids = {
    turnId: 'turn-1',
    optimisticSessionId: 'draft-1',
    realSessionId: 'thread-1',
    previousSessionId: 'old-thread'
  };
  assert.equal(turnMatchesSelection({ id: 'draft-1' }, ids), true);
  assert.equal(turnMatchesSelection({ id: 'thread-1' }, ids), true);
  assert.equal(turnMatchesSelection({ id: 'old-thread' }, ids), true);
  assert.equal(turnMatchesSelection({ id: 'other', turnId: 'turn-1' }, ids), true);
  assert.equal(turnMatchesSelection({ id: 'other', draft: true }, ids), true);
  assert.equal(turnMatchesSelection({ id: 'other' }, ids), false);
});

test('sessionForTurnSelection prefers the synchronous selection ref', () => {
  const staleSession = { id: 'thread-before-render' };
  const draftSession = { id: 'draft-project-1', draft: true };

  assert.equal(sessionForTurnSelection(staleSession, { current: draftSession }), draftSession);
  assert.equal(sessionForTurnSelection(staleSession, { current: null }), staleSession);
});

test('projectForTurnSelection prefers the synchronous project ref', () => {
  const staleProject = { id: 'project-before-render' };
  const currentProject = { id: 'project-current' };

  assert.equal(projectForTurnSelection(staleProject, { current: currentProject }), currentProject);
  assert.equal(projectForTurnSelection(staleProject, { current: null }), staleProject);
});

test('projectForTurnSelection falls back to the selected draft project id', () => {
  const project = { id: 'project-from-draft', name: 'CodexMobile' };
  const draftSession = { id: 'draft-project-from-draft-1', projectId: project.id, draft: true };

  assert.equal(projectForTurnSelection(null, { current: null }, null, { current: draftSession }, [project]), project);
});

test('displayMessageForTurn provides attachment and file mention fallbacks', () => {
  assert.equal(displayMessageForTurn('  hello  ', [], []), 'hello');
  assert.equal(displayMessageForTurn('', [{ path: '/tmp/a.png' }], []), '请查看附件。');
  assert.equal(displayMessageForTurn('', [], [{ path: '/tmp/a.js' }]), '请查看引用文件。');
  assert.equal(displayMessageForTurn('', [], []), '');
});

test('prepareComposerSubmission strips leading plan command and marks collaboration mode', () => {
  assert.deepEqual(prepareComposerSubmission('/plan 先给我方案', [], []), {
    message: '先给我方案',
    collaborationMode: 'plan'
  });
  assert.deepEqual(prepareComposerSubmission('/计划模式', [], [{ path: '/tmp/a.js' }]), {
    message: '请查看引用文件。',
    collaborationMode: 'plan'
  });
});

test('selectedSkillsForPaths returns structured skills without leaking tokens', () => {
  const selected = selectedSkillsForPaths(
    [
      { name: 'frontend-design', path: '/skills/frontend-design' },
      { label: 'unused', path: '/skills/unused' }
    ],
    ['/skills/frontend-design']
  );
  assert.deepEqual(selected, [{ name: 'frontend-design', path: '/skills/frontend-design' }]);
});

test('restoredComposerText appends failed message text only once', () => {
  assert.equal(restoredComposerText('', '继续修复'), '继续修复');
  assert.equal(restoredComposerText('先看日志', '继续修复'), '先看日志\n继续修复');
  assert.equal(restoredComposerText('先看日志\n继续修复', '继续修复'), '先看日志\n继续修复');
});
