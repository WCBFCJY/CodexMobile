/**
 * 聊天主滚动区：会话切换时跟底、显示回到底部按钮与消息列表容器。
 *
 * Keywords: ChatPane, scroll, chat messages
 *
 * Exports:
 * - ChatPane — 包裹 ChatMessage 列表与底部对齐逻辑。
 *
 * Inward: ../chat-scroll.js、session-utils、ChatMessage.jsx
 *
 * Outward: App.jsx
 */

import { AlertCircle, ArrowDown, Loader2, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isNearChatBottom, shouldFollowChatOutput } from '../chat-scroll.js';
import { payloadRunKeys, selectedRunKeys } from '../app/session-utils.js';
import { ChatMessage } from './ChatMessage.jsx';

export function ChatPane({
  messages,
  selectedSession,
  loading = false,
  loadError = '',
  running,
  activeRunKeys = [],
  now,
  onPreviewImage,
  onDeleteMessage,
  onImplementPlan,
  onAdjustPlan
}) {
  const paneRef = useRef(null);
  const contentRef = useRef(null);
  const bottomPinnedRef = useRef(true);
  const pendingInitialScrollSessionRef = useRef(null);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const hasMessages = messages.length > 0;
  const sessionId = selectedSession?.id || '';
  const pinnedBeforeRender = bottomPinnedRef.current;
  const activeActivityMessageId = running ? latestSelectedActivityMessageId(messages, selectedSession, activeRunKeys) : '';

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const pane = paneRef.current;
    if (!pane) {
      return;
    }
    pane.scrollTo({ top: pane.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return undefined;
    }

    function updatePinnedState() {
      const pinned = isNearChatBottom(pane);
      bottomPinnedRef.current = pinned;
      setShowScrollLatest(!pinned);
    }

    updatePinnedState();
    pane.addEventListener('scroll', updatePinnedState, { passive: true });
    return () => pane.removeEventListener('scroll', updatePinnedState);
  }, [hasMessages]);

  useLayoutEffect(() => {
    const force = Boolean(hasMessages && sessionId && pendingInitialScrollSessionRef.current === sessionId);
    if (!shouldFollowChatOutput({ pinnedToBottom: bottomPinnedRef.current, pinnedBeforeUpdate: pinnedBeforeRender, running, force })) {
      return undefined;
    }
    scrollToBottom('auto');
    setShowScrollLatest(false);
    bottomPinnedRef.current = true;
    if (force) {
      pendingInitialScrollSessionRef.current = null;
    }
    return undefined;
  }, [messages, running, scrollToBottom, hasMessages, sessionId]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (shouldFollowChatOutput({ pinnedToBottom: bottomPinnedRef.current, running })) {
        scrollToBottom('auto');
      }
    });
    observer.observe(contentRef.current || pane);
    return () => observer.disconnect();
  }, [running, scrollToBottom]);

  useLayoutEffect(() => {
    pendingInitialScrollSessionRef.current = selectedSession?.id || null;
    bottomPinnedRef.current = true;
    setShowScrollLatest(false);
    scrollToBottom('auto');
    return undefined;
  }, [selectedSession?.id, scrollToBottom]);

  if (loading) {
    return (
      <section className="chat-pane chat-loading" ref={paneRef} aria-busy="true" aria-live="polite">
        <div className="chat-loading-card">
          <Loader2 className="spin" size={22} />
          <div>
            <strong>{selectedSession?.title || '对话'}</strong>
            <span>正在加载消息</span>
          </div>
        </div>
        <div className="chat-loading-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="chat-pane chat-load-error" ref={paneRef} role="alert">
        <div className="empty-orbit">
          <AlertCircle size={30} />
        </div>
        <h2>加载失败</h2>
        <p>{loadError}</p>
      </section>
    );
  }

  if (!messages.length) {
    return (
      <section className="chat-pane empty-chat">
        <div className="empty-orbit">
          <ShieldCheck size={30} />
        </div>
        <h2>{selectedSession ? selectedSession.title : '新对话'}</h2>
        <p>问 Codex 任何事。</p>
      </section>
    );
  }

  return (
    <section className="chat-pane" ref={paneRef}>
      <div className="chat-content" ref={contentRef}>
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            now={now}
            activeActivityMessageId={activeActivityMessageId}
            onPreviewImage={onPreviewImage}
            onDeleteMessage={onDeleteMessage}
            onImplementPlan={onImplementPlan}
            onAdjustPlan={onAdjustPlan}
          />
        ))}
      </div>
      {showScrollLatest ? (
        <button
          type="button"
          className="scroll-latest-button"
          onClick={() => {
            scrollToBottom('smooth');
            bottomPinnedRef.current = true;
            setShowScrollLatest(false);
          }}
          aria-label="回到最新消息"
        >
          <ArrowDown size={16} />
        </button>
      ) : null}
    </section>
  );
}

function latestSelectedActivityMessageId(messages = [], selectedSession = null, activeRunKeys = []) {
  const selectedKeys = new Set(activeRunKeys.length ? activeRunKeys : selectedRunKeys(selectedSession));
  if (!selectedKeys.size) {
    return '';
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'activity') {
      continue;
    }
    if (payloadRunKeys(message).some((key) => selectedKeys.has(key))) {
      return message.id || '';
    }
  }
  return '';
}
