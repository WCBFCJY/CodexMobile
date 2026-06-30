/**
 * 单条聊天消息壳层：用户/助手复制、活动气泡、计划/交互请求与图片条分发，并稳定普通消息重渲染。
 *
 * Keywords: ChatMessage, copy, plan, activity, memo
 *
 * Exports:
 * - ChatMessage — 按 role 路由到 ActivityMessage、PlanMessage 或标准气泡。
 *
 * Inward: session-utils、MarkdownContent、PlanMessage、InteractionRequestMessage、ActivityMessage、ImagePreview。
 *
 * Outward: ChatPane.jsx
 */

import { Check, Copy, CornerDownRight, Trash2 } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { formatTime } from '../app/session-utils.js';
import { copyTextToClipboard } from '../utils/clipboard.js';
import { ActivityMessage } from './ActivityMessage.jsx';
import { MessageContent, splitMessageImages } from './MarkdownContent.jsx';
import { PlanMessage } from './PlanMessage.jsx';
import { InteractionRequestMessage } from './InteractionRequestMessage.jsx';
import { UserImageStrip } from './ImagePreview.jsx';

function ChatMessageView({
  message,
  now,
  onPreviewImage,
  onDeleteMessage,
  onImplementPlan,
  onAdjustPlan,
  afterContent = null,
  isLastAssistantInTurn = false
}) {
  const [copied, setCopied] = useState(false);
  const [touchActive, setTouchActive] = useState(false);
  const copiedTimerRef = useRef(null);
  const messageRowRef = useRef(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  // 触屏设备点击消息气泡显示操作按钮
  useEffect(() => {
    const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (!isTouchDevice) return;

    const handleClick = (e) => {
      const row = messageRowRef.current;
      if (!row) return;

      // 点击操作按钮区域不切换状态
      if (e.target.closest('.message-actions')) return;

      // 点击当前消息，显示操作按钮
      if (row.contains(e.target)) {
        setTouchActive(true);
      } else {
        // 点击其他地方，隐藏
        setTouchActive(false);
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (message.role === 'activity') {
    return (
      <ActivityMessage
        message={message}
        now={now}
      />
    );
  }
  if (message.role === 'plan' || message.role === 'plan_request') {
    return (
      <PlanMessage
        message={message}
        onPreviewImage={onPreviewImage}
        onImplementPlan={onImplementPlan}
        onAdjustPlan={onAdjustPlan}
      />
    );
  }
  if (message.role === 'interaction_request') {
    return <InteractionRequestMessage message={message} />;
  }
  const isUser = message.role === 'user';
  const isGuided = isUser && (message.guided || message.kind === 'guided_user');
  const canAct = message.role === 'user' || (message.role === 'assistant' && isLastAssistantInTurn);
  const userMedia = isUser ? splitMessageImages(message.content) : { text: message.content, images: [] };
  const visibleContent = isUser ? userMedia.text : message.content;
  const userDeliveryText = isUser ? deliveryStatusText(message) : '';

  async function handleCopy() {
    const copiedText = await copyTextToClipboard(message.content);
    if (!copiedText) {
      window.alert('复制失败');
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div ref={messageRowRef} className={`message-row ${isUser ? 'is-user' : 'is-assistant'} ${touchActive ? 'is-touch-active' : ''}`}>
      <div className="message-stack">
        {isGuided ? (
          <div className="message-guide-label">
            <CornerDownRight size={13} strokeWidth={1.8} />
            <span>{message.guideLabel || '已引导对话'}</span>
          </div>
        ) : null}
        {isUser ? <UserImageStrip images={userMedia.images} onPreviewImage={onPreviewImage} /> : null}
        {visibleContent ? (
          <div className="message-bubble">
            <MessageContent content={visibleContent} onPreviewImage={onPreviewImage} />
            {isUser && userDeliveryText ? (
              <span className={`message-delivery is-${message.deliveryState || 'confirmed'}`}>{userDeliveryText}</span>
            ) : message.timestamp ? <time>{formatTime(message.timestamp)}</time> : null}
          </div>
        ) : null}
        {afterContent ? <div className="message-after-content">{afterContent}</div> : null}
        {canAct ? (
          <div className="message-actions" aria-label="消息操作">
            <button type="button" className="message-action" onClick={handleCopy} title={copied ? '已复制' : '复制'}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button type="button" className="message-action is-delete" onClick={() => onDeleteMessage?.(message)} title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function chatMessagePropsEqual(previous, next) {
  if (previous.message !== next.message) {
    return false;
  }
  if (previous.afterContent !== next.afterContent) {
    return false;
  }
  if (
    previous.onPreviewImage !== next.onPreviewImage ||
    previous.onDeleteMessage !== next.onDeleteMessage ||
    previous.onImplementPlan !== next.onImplementPlan ||
    previous.onAdjustPlan !== next.onAdjustPlan
  ) {
    return false;
  }
  const role = previous.message?.role || '';
  if (role === 'activity' || role === 'plan' || role === 'plan_request') {
    return previous.now === next.now;
  }
  return true;
}

export const ChatMessage = memo(ChatMessageView, chatMessagePropsEqual);

function deliveryStatusText(message) {
  if (message.deliveryState === 'pending') {
    return '发送中...';
  }
  if (message.deliveryState === 'failed') {
    return '发送失败';
  }
  return message.timestamp ? formatTime(message.timestamp) : '';
}
