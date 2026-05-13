/**
 * 活动类消息气泡：折叠摘要、时长与执行时间线。
 *
 * Keywords: activity message, timeline, running
 *
 * Exports:
 * - ActivityMessage — 渲染单条 activity role 消息或 null。
 *
 * Inward: session-utils、activity-model、activity-timeline-projection、ActivityTimeline。
 *
 * Outward: ChatMessage.jsx
 */

import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDuration, formatDurationMs } from '../app/session-utils.js';
import { activityCardShouldOpen, effectiveActivityMessageIsRunning } from './activity-card-state.js';
import { isVisibleActivityStep, shouldRenderActivityMessageInChat } from './activity-model.js';
import { ActivityTimeline } from './ActivityTimeline.jsx';
import { projectActivityView } from './activity-timeline-projection.js';

export function ActivityMessage({ message, now = Date.now(), forceRunning = false }) {
  if (!shouldRenderActivityMessageInChat(message)) {
    return null;
  }
  const activities = message.activities || [];
  const running = effectiveActivityMessageIsRunning({ message, activities, forceRunning });
  const failed = message.status === 'failed';
  const visibleSteps = activities.filter((activity) => isVisibleActivityStep(activity, message.status));
  const { timeRange, timeline } = projectActivityView(visibleSteps, { running });
  const hasProcess = timeline.length > 0;
  const [open, setOpen] = useState(() => activityCardShouldOpen({ running, hasProcess }));
  const startedAt = message.startedAt || timeRange.startedAt || message.timestamp;
  const endedAt = running ? now : message.completedAt || timeRange.endedAt || message.timestamp || now;
  const duration = !running ? formatDurationMs(message.durationMs) || formatDuration(startedAt, endedAt) : formatDuration(startedAt, endedAt);
  const headline = failed ? '处理失败' : running ? '处理中' : '已处理';

  useEffect(() => {
    setOpen(activityCardShouldOpen({ running, hasProcess }));
  }, [message.id, running, hasProcess]);

  return (
    <div className="message-row is-activity">
      <div
        className={[
          'message-bubble activity-bubble',
          failed ? 'is-failed' : '',
          open ? 'is-open' : 'is-folded'
        ].filter(Boolean).join(' ')}
      >
        <button
          type="button"
          className="activity-summary"
          aria-expanded={hasProcess ? open : undefined}
          disabled={!hasProcess}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={`activity-summary-dot ${running ? 'is-running' : ''}`} aria-hidden="true" />
          <span className="activity-summary-title">{headline}</span>
          {duration ? <span className="activity-summary-duration">{duration}</span> : null}
          {hasProcess ? <ChevronDown className={`activity-chevron ${open ? 'is-open' : ''}`} size={15} /> : null}
        </button>
        {open && hasProcess ? (
          <ActivityTimeline
            timeline={timeline}
          />
        ) : null}
      </div>
    </div>
  );
}
