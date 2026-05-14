/**
 * 聊天消息渲染队列：把运行中过程投影成单流，并把已完成文件变更挂到同轮助手结果下方。
 *
 * Keywords: chat render, activity files, process stream, message order
 *
 * Exports:
 * - chatRenderItems — 生成 ChatPane 可直接渲染的消息/文件卡片条目。
 * - fileSummaryForActivityMessage — 从单条 activity 消息提取完成后的文件汇总。
 * - projectMessagesForActiveProcess — 运行中只保留一个当前过程流。
 *
 * Inward: activity-card-state、activity-model、activity-timeline-projection。
 *
 * Outward: ChatPane.jsx、chat-render-items.test.mjs。
 */

import { effectiveActivityMessageIsRunning } from './activity-card-state.js';
import {
  coalesceActivityMessages,
  isVisibleActivityStep,
  mergeActivityMessages,
  shouldCoalesceActivityMessages,
  shouldRenderActivityMessageInChat
} from './activity-model.js';
import { projectActivityView } from './activity-timeline-projection.js';

export function fileSummaryForActivityMessage(message, { forceRunning = false } = {}) {
  if (message?.role !== 'activity' || !shouldRenderActivityMessageInChat(message)) {
    return null;
  }
  const activities = message.activities || [];
  const running = effectiveActivityMessageIsRunning({ message, activities, forceRunning });
  if (running) {
    return null;
  }
  const visibleSteps = activities.filter((activity) => isVisibleActivityStep(activity, message.status));
  return projectActivityView(visibleSteps, { running }).fileSummary;
}

export function projectMessagesForActiveProcess(messages = [], activeActivityMessageId = '') {
  const coalesced = coalesceActivityMessages(Array.isArray(messages) ? messages : []);
  if (!activeActivityMessageId) {
    return coalesced;
  }
  const activeIndex = coalesced.findIndex((message) => message?.role === 'activity' && message.id === activeActivityMessageId);
  const active = activeIndex >= 0 ? coalesced[activeIndex] : null;
  if (!active) {
    return coalesced;
  }

  let processMessage = active;
  const swallowedIds = new Set();
  coalesced.forEach((message) => {
    if (message === active || message?.role !== 'activity') {
      return;
    }
    if (!shouldCoalesceActivityMessages(message, processMessage)) {
      return;
    }
    processMessage = mergeActivityMessages(message, processMessage);
    if (message.id) {
      swallowedIds.add(message.id);
    }
  });

  if (!swallowedIds.size) {
    return coalesced;
  }
  return coalesced
    .filter((message) => !swallowedIds.has(message?.id))
    .map((message) => (message === active ? processMessage : message));
}

export function chatRenderItems(messages = [], { activeActivityMessageId = '' } = {}) {
  const projectedMessages = projectMessagesForActiveProcess(messages, activeActivityMessageId);
  const items = [];
  const pendingByTurn = new Map();

  const queueFileSummary = (message) => {
    const summary = fileSummaryForActivityMessage(message, {
      forceRunning: Boolean(activeActivityMessageId && message.id === activeActivityMessageId)
    });
    if (!summary) {
      return;
    }
    const key = activityResultKey(message);
    const entry = {
      type: 'fileSummary',
      key: `file-summary-${message.id}`,
      summary
    };
    if (!key) {
      items.push(entry);
      return;
    }
    pendingByTurn.set(key, [...(pendingByTurn.get(key) || []), entry]);
  };

  const flushFileSummaries = (message, item) => {
    for (const key of resultKeysForMessage(message)) {
      const pending = pendingByTurn.get(key);
      if (!pending?.length) {
        continue;
      }
      item.fileSummaries = [...(item.fileSummaries || []), ...pending.map((entry) => entry.summary)];
      pendingByTurn.delete(key);
    }
  };

  for (const message of projectedMessages) {
    const item = { type: 'message', key: message.id || `${items.length}`, message };
    items.push(item);
    if (message?.role === 'activity') {
      queueFileSummary(message);
    } else if (message?.role === 'assistant') {
      flushFileSummaries(message, item);
    }
  }

  return items;
}

function activityResultKey(message = {}) {
  const turnId = String(message.turnId || '').trim();
  if (!turnId) {
    return '';
  }
  return `${turnId}:${numericSegmentIndex(message.segmentIndex) ?? 0}`;
}

function resultKeysForMessage(message = {}) {
  const turnId = String(message.turnId || '').trim();
  if (!turnId) {
    return [];
  }
  const segmentIndex = numericSegmentIndex(message.segmentIndex);
  return segmentIndex === null ? [`${turnId}:0`] : [`${turnId}:${segmentIndex}`, `${turnId}:0`];
}

function numericSegmentIndex(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
