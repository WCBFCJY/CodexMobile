/**
 * 测试 server/chat-service.js：发送消息、队列与依赖注入路径。
 *
 * Keywords: chat-service, test, integration
 *
 * Exports: 无导出，内含用例
 *
 * Inward: chat-service.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatService } from './chat-service.js';

function makeChatService(overrides = {}) {
  const broadcasts = [];
  const service = createChatService({
    imagePromptState: '/tmp/codexmobile-chat-service-test.json',
    getProject: () => ({ id: 'project-1', name: 'Project', path: '/tmp/project', projectless: false }),
    getSession: () => ({ id: 'thread-1', projectId: 'project-1' }),
    getCacheSnapshot: () => ({ config: { skills: [], model: 'gpt-5.5' } }),
    listProjectSessions: () => [],
    refreshCodexCache: async () => ({ syncedAt: 'now', projects: [] }),
    renameSession: async () => null,
    broadcast: (payload) => broadcasts.push(payload),
    runCodexTurn: async () => 'thread-1',
    abortCodexTurn: () => true,
    getActiveRuns: () => [],
    runImageTurn: async () => 'thread-1',
    isImageRequest: () => false,
    useLegacyImageGenerator: () => false,
    maybeAutoNameSession: async () => false,
    registerProjectlessThread: async () => null,
    registerMobileSession: async () => null,
    rememberLiveSession: () => null,
    ...overrides
  });
  return { service, broadcasts };
}

async function flushQueuedWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('sendChat rejects steer mode with 409', async () => {
  const { service } = makeChatService();

  await assert.rejects(
    service.sendChat({
      projectId: 'project-1',
      sessionId: 'thread-1',
      clientTurnId: 'client-turn',
      message: '补充这个方向',
      sendMode: 'steer'
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'STEER_NOT_SUPPORTED');
      return true;
    }
  );
});

test('sendChat uses headless local for regular messages', async () => {
  let runPayload = null;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: 'hello'
  });

  assert.equal(result.accepted, true);
  assert.equal(runPayload.sessionId, 'thread-1');
  assert.equal(broadcasts.some((payload) => payload.type === 'user-message'), true);
});

test('abortChat records and broadcasts an aborted turn even after the backend run is gone', async () => {
  let abortedIdentifier = null;
  const { service, broadcasts } = makeChatService({
    abortCodexTurn: (identifier) => {
      abortedIdentifier = identifier;
      return false;
    }
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1',
    turnId: 'client-turn-1',
    previousSessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(abortedIdentifier, 'client-turn-1');
  assert.equal(service.getTurn('client-turn-1').status, 'aborted');
  assert.equal(service.getTurn('client-turn-1').sessionId, 'thread-1');
  assert.equal(broadcasts.at(-1).type, 'chat-aborted');
  assert.equal(broadcasts.at(-1).turnId, 'client-turn-1');
  assert.equal(broadcasts.at(-1).sessionId, 'thread-1');
});

test('sendChat creates draft threads through headless local', async () => {
  let runPayload = null;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'thread-started', sessionId: 'headless-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      emit({ type: 'chat-complete', sessionId: 'headless-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      return 'headless-thread-1';
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    message: '手机新建一个同源对话'
  });

  assert.equal(result.accepted, true);
  assert.equal(runPayload.draftSessionId, 'draft-project-1-1');
  assert.equal(broadcasts.some((payload) => payload.type === 'user-message'), true);
});

test('sendChat uses headless local for existing threads', async () => {
  let runPayload = null;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '从手机发送到已有线程'
  });

  assert.equal(result.delivery, 'started');
  assert.equal(result.sessionId, 'thread-1');
  assert.ok(runPayload);
});

test('sendChat uses headless local for existing threads with bridge info', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: '从手机发到已有线程'
  });

  assert.equal(result.delivery, 'started');
  assert.equal(result.sessionId, 'thread-1');
  assert.equal(runPayload.sessionId, 'thread-1');
  assert.match(runPayload.message, /从手机发到已有线程/);
});

test('sendChat records headless runtime source', async () => {
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '从手机发到后台 headless 运行'
  });

  assert.equal(result.turnId, 'client-turn-1');
  assert.equal(service.getTurn('client-turn-1')?.source, 'headless-local');
});

test('abortChat works after mobile sends via headless', async () => {
  const { service, broadcasts } = makeChatService({
    abortCodexTurn: () => false
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '准备从手机中止任务'
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1',
    turnId: 'client-turn-1',
    previousSessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(service.getTurn('client-turn-1').status, 'aborted');
  assert.equal(broadcasts.some((payload) => payload.type === 'chat-aborted'), true);
});

test('abortChat creates local abort record when turn id does not match active run', async () => {
  const { service } = makeChatService({
    abortCodexTurn: () => false
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '准备用 session id 兜底中止'
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1',
    turnId: 'stale-mobile-turn-id'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(service.getTurn('stale-mobile-turn-id').status, 'aborted');
});

test('abortChat aborts an active headless run by turn id', async () => {
  let abortedIdentifier = null;
  const { service, broadcasts } = makeChatService({
    getActiveRuns: () => [{
      sessionId: 'thread-1',
      previousSessionId: 'thread-1',
      turnId: 'headless-turn-1',
      status: 'running',
      source: 'headless-local'
    }],
    abortCodexTurn: (identifier) => {
      abortedIdentifier = identifier;
      return true;
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-1',
    message: '先创建一个任务'
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1',
    turnId: 'headless-turn-1',
    previousSessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(abortedIdentifier, 'headless-turn-1');
  assert.equal(broadcasts.at(-1).type, 'chat-aborted');
  assert.equal(broadcasts.at(-1).source, 'headless-local');
  assert.equal(broadcasts.at(-1).turnId, 'headless-turn-1');
});

test('abortChat returns false when no matching turn or active run exists', async () => {
  const { service, broadcasts } = makeChatService({
    abortCodexTurn: () => false
  });

  const aborted = await service.abortChat({
    projectId: 'project-1',
    sessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, false);
  assert.equal(broadcasts.length, 0);
});

test('abortChat clears a headless turn by session when activeRuns has already dropped it', async () => {
  let abortedIdentifier = null;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async () => new Promise(() => {}),
    abortCodexTurn: (identifier) => {
      abortedIdentifier = identifier;
      return false;
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-session-only',
    message: '这个任务会卡住'
  });

  const aborted = await service.abortChat({
    sessionId: 'thread-1'
  }, { remoteAddress: '127.0.0.1' });

  assert.equal(aborted, true);
  assert.equal(abortedIdentifier, 'client-turn-session-only');
  assert.equal(service.getTurn('client-turn-session-only').status, 'aborted');
  assert.equal(broadcasts.at(-1).type, 'chat-aborted');
  assert.equal(broadcasts.at(-1).turnId, 'client-turn-session-only');
});

test('headless runner rejection emits a terminal failure and frees the next send', async () => {
  let runCount = 0;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runCount += 1;
      if (runCount === 1) {
        throw new Error('Request failed: 404');
      }
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const first = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-fail',
    message: '第一次失败'
  });
  await flushQueuedWork();

  const second = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-after-fail',
    message: '第二次应该直接启动'
  });
  await flushQueuedWork();

  assert.equal(first.delivery, 'started');
  assert.equal(service.getTurn('client-turn-fail').status, 'failed');
  assert.equal(broadcasts.some((payload) => payload.type === 'chat-error' && payload.turnId === 'client-turn-fail'), true);
  assert.equal(second.delivery, 'started');
  assert.equal(service.getTurn('client-turn-after-fail').status, 'completed');
});

test('post-run cache refresh does not keep the conversation queue running', async () => {
  let runCount = 0;
  let refreshStarted = false;
  const { service } = makeChatService({
    refreshCodexCache: async () => {
      refreshStarted = true;
      return new Promise(() => {});
    },
    runCodexTurn: async (payload, emit) => {
      runCount += 1;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const first = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-refresh-1',
    message: '第一次完成但刷新很慢'
  });
  await flushQueuedWork();

  const second = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn-refresh-2',
    message: '第二次不能被刷新阻塞'
  });
  await flushQueuedWork();

  assert.equal(first.delivery, 'started');
  assert.equal(refreshStarted, true);
  assert.equal(second.delivery, 'started');
  assert.equal(runCount, 2);
});

test('sendChat sends plan requests through headless with collaboration mode', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: '先给我计划',
    collaborationMode: 'plan',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    serviceTier: 'fast'
  });

  assert.equal(result.delivery, 'started');
  assert.deepEqual(runPayload.collaborationMode, {
    mode: 'plan',
    settings: {
      model: 'gpt-5.5',
      reasoning_effort: 'high',
      developer_instructions: null
    }
  });
  assert.equal(runPayload.serviceTier, 'fast');
});

test('sendChat leaves collaboration mode untouched for normal headless follow-up turns', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: '执行计划'
  });

  assert.equal(result.delivery, 'started');
  assert.equal(runPayload.collaborationMode, null);
});

test('sendChat exits plan mode explicitly before implementing a plan', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: 'Implement plan.',
    collaborationMode: 'default',
    model: 'gpt-5.5',
    reasoningEffort: 'high'
  });

  assert.equal(result.delivery, 'started');
  assert.deepEqual(runPayload.collaborationMode, {
    mode: 'default',
    settings: {
      model: 'gpt-5.5',
      reasoning_effort: 'high',
      developer_instructions: null
    }
  });
});

test('sendChat implements proposed plans through headless with full plan content', async () => {
  let runPayload = null;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-plan-turn',
    message: 'Implement plan.',
    visibleMessage: '执行计划',
    collaborationMode: 'default',
    planImplementation: {
      planContent: '# 修复计划\n\n## Summary\n处理计划执行失败。'
    }
  });

  assert.equal(result.delivery, 'started');
  assert.equal(broadcasts.filter((payload) => payload.type === 'user-message').length, 1);
  assert.match(runPayload.message, /^PLEASE IMPLEMENT THIS PLAN:/);
  assert.match(runPayload.message, /处理计划执行失败/);
});

test('sendChat uses headless local directly for existing threads', async () => {
  let runPayload = null;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn',
    message: '移动端发送只走后台'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.delivery, 'started');
  assert.equal(runPayload.sessionId, 'thread-1');
  assert.match(runPayload.message, /移动端发送只走后台/);
  assert.equal(broadcasts.filter((payload) => payload.type === 'user-message').length, 1);
});

test('sendChat does not push mobile model settings into headless run unnecessarily', async () => {
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn',
    message: '确认执行这个计划',
    model: 'gpt-5.5',
    reasoningEffort: 'medium'
  });

  assert.equal(result.accepted, true);
});

test('sendChat does not wait for desktop bridge before using headless local', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn',
    message: '移动端发送不等待桌面 IPC'
  });

  assert.equal(result.accepted, true);
  assert.equal(runPayload.sessionId, 'thread-1');
  assert.match(runPayload.message, /移动端发送不等待桌面 IPC/);
});

test('sendChat does not wait for a bridge owner before using headless local', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'client-turn',
    message: '等桌面 owner 绑定后再执行'
  });

  assert.equal(result.turnId, 'client-turn');
  assert.equal(runPayload.sessionId, 'thread-1');
});

test('sendChat can create a background thread for new conversations', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'thread-started', sessionId: 'background-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      emit({ type: 'chat-complete', sessionId: 'background-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      return 'background-thread-1';
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn',
    message: '从手机后台新建'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.delivery, 'started');
  assert.equal(runPayload.draftSessionId, 'draft-project-1-1');
  assert.match(runPayload.message, /从手机后台新建/);
});

test('sendChat reuses a background-created thread alias for later headless sends', async () => {
  const runPayloads = [];
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayloads.push(payload);
      emit({
        type: 'thread-started',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      emit({
        type: 'chat-complete',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return 'background-thread-1';
    }
  });

  const first = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn-1',
    message: '从手机后台新建'
  });
  await flushQueuedWork();

  const second = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn-2',
    message: '继续这条线程'
  });
  await flushQueuedWork();

  assert.equal(second.sessionId, 'background-thread-1');
  assert.ok(['started', 'queued'].includes(second.delivery));
  assert.equal(runPayloads.at(0).draftSessionId, 'draft-project-1-1');
});

test('sendChat remembers a started background thread path before broadcasting it', async () => {
  const events = [];
  const { service } = makeChatService({
    broadcast: (payload) => events.push(`broadcast:${payload.type}`),
    rememberLiveSession: (session) => events.push(`remember:${session.id}:${session.filePath}`),
    runCodexTurn: async (payload, emit) => {
      emit({
        type: 'thread-started',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId,
        filePath: '/tmp/background-rollout.jsonl',
        startedAt: '2026-05-07T08:00:00.000Z'
      });
      emit({
        type: 'chat-complete',
        sessionId: 'background-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return 'background-thread-1';
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1',
    clientTurnId: 'client-turn',
    message: '后台新线程'
  });
  await flushQueuedWork();

  const rememberedIndex = events.findIndex((event) => event === 'remember:background-thread-1:/tmp/background-rollout.jsonl');
  const broadcastIndex = events.findIndex((event) => event === 'broadcast:thread-started');
  assert.ok(rememberedIndex >= 0);
  assert.ok(broadcastIndex > rememberedIndex);
});

test('sendChat starts project-bound draft threads in the selected project cwd', async () => {
  let runPayload = null;
  let projectlessRegistrationCount = 0;
  let mobileRegistration = null;
  const { service } = makeChatService({
    getProject: () => ({
      id: 'project-codexmobile',
      name: 'CodexMobile',
      path: '/Users/xiayanghui/Code/CodexMobile',
      projectless: false
    }),
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({
        type: 'thread-started',
        sessionId: 'project-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId,
        cwd: payload.projectPath,
        startedAt: '2026-05-14T12:00:00.000Z'
      });
      emit({
        type: 'chat-complete',
        sessionId: 'project-thread-1',
        previousSessionId: payload.draftSessionId,
        turnId: payload.turnId
      });
      return 'project-thread-1';
    },
    registerProjectlessThread: async () => {
      projectlessRegistrationCount += 1;
    },
    registerMobileSession: async (session) => {
      mobileRegistration = session;
    }
  });

  await service.sendChat({
    projectId: 'project-codexmobile',
    draftSessionId: 'draft-project-codexmobile-1',
    clientTurnId: 'client-turn',
    message: '在项目里开新线程'
  });
  await flushQueuedWork();

  assert.equal(runPayload.projectPath, '/Users/xiayanghui/Code/CodexMobile');
  assert.equal(projectlessRegistrationCount, 0);
  assert.equal(mobileRegistration.projectPath, '/Users/xiayanghui/Code/CodexMobile');
  assert.equal(mobileRegistration.projectless, false);
});

test('sendChat starts a headless local Codex turn when bridge is in headless mode', async () => {
  let runPayload = null;
  const { service, broadcasts } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'thread-started', sessionId: 'headless-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      emit({ type: 'chat-complete', sessionId: 'headless-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      return 'headless-thread-1';
    }
  });

  const result = await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    clientTurnId: 'client-turn',
    message: '桌面端没开也跑一下'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.delivery, 'started');
  assert.equal(runPayload.draftSessionId, 'draft-project-1-1');
  assert.match(runPayload.message, /桌面端没开也跑一下/);
  assert.equal(broadcasts.some((payload) => payload.type === 'user-message'), true);
  assert.equal(broadcasts.find((payload) => payload.type === 'thread-started')?.source, 'headless-local');
  assert.equal(broadcasts.find((payload) => payload.type === 'chat-complete')?.source, 'headless-local');
});

test('sendChat passes plan collaboration mode to headless local Codex turns', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'thread-started', sessionId: 'headless-plan-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      emit({ type: 'chat-complete', sessionId: 'headless-plan-thread-1', previousSessionId: payload.draftSessionId, turnId: payload.turnId });
      return 'headless-plan-thread-1';
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    draftSessionId: 'draft-project-1-1',
    message: '先规划一下',
    collaborationMode: 'plan',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    serviceTier: 'fast'
  });

  assert.equal(runPayload.serviceTier, 'fast');
  assert.deepEqual(runPayload.collaborationMode, {
    mode: 'plan',
    settings: {
      model: 'gpt-5.5',
      reasoning_effort: 'high',
      developer_instructions: null
    }
  });
});

test('queue drafts can be listed, deleted, and restored without auto starting during active work', async () => {
  const { service } = makeChatService({
    getActiveRuns: () => [{ sessionId: 'thread-1', status: 'running' }],
    getCacheSnapshot: () => ({
      config: {
        model: 'gpt-5.5',
        skills: [{ name: 'frontend-design', path: '/skills/frontend-design/SKILL.md' }]
      }
    })
  });

  const first = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'queued-turn-1',
    message: '排队草稿 1',
    sendMode: 'queue',
    selectedSkills: [{ path: '/skills/frontend-design/SKILL.md' }],
    fileMentions: [{ name: 'App.jsx', path: '/repo/client/src/App.jsx' }]
  });
  const second = await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    clientTurnId: 'queued-turn-2',
    message: '排队草稿 2',
    sendMode: 'queue'
  });

  assert.equal(first.delivery, 'queued');
  assert.equal(second.delivery, 'queued');
  let queue = service.listQueue({ sessionId: 'thread-1' });
  assert.equal(queue.drafts.length, 2);
  assert.equal(queue.drafts[0].text, '排队草稿 1');
  assert.equal(queue.drafts[0].selectedSkills[0].path, '/skills/frontend-design/SKILL.md');
  assert.equal(queue.drafts[0].fileMentions[0].path, '/repo/client/src/App.jsx');

  const deleted = service.removeQueuedDraft({ sessionId: 'thread-1', draftId: 'queued-turn-2' });
  assert.equal(deleted.text, '排队草稿 2');
  queue = service.listQueue({ sessionId: 'thread-1' });
  assert.equal(queue.drafts.length, 1);

  const restored = service.restoreQueuedDraft({ sessionId: 'thread-1', draftId: 'queued-turn-1' });
  assert.equal(restored.text, '排队草稿 1');
  assert.equal(service.listQueue({ sessionId: 'thread-1' }).drafts.length, 0);
});

test('file mentions are appended to normal chat sends', async () => {
  let runPayload = null;
  const { service } = makeChatService({
    runCodexTurn: async (payload, emit) => {
      runPayload = payload;
      emit({ type: 'chat-complete', sessionId: payload.sessionId, turnId: payload.turnId });
      return payload.sessionId;
    }
  });

  await service.sendChat({
    projectId: 'project-1',
    sessionId: 'thread-1',
    message: '看文件',
    fileMentions: [{ name: 'App.jsx', path: '/repo/client/src/App.jsx' }]
  });

  assert.match(runPayload.message, /看文件/);
  assert.match(runPayload.message, /引用文件路径/);
  assert.match(runPayload.message, /App\.jsx \(\/repo\/client\/src\/App\.jsx\)/);
});
