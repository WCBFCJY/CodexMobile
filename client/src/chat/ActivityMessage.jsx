import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDuration, formatDurationMs } from '../app/session-utils.js';
import { activityCardShouldOpen } from './activity-card-state.js';
import { isPlaceholderActivityMessage, isVisibleActivityStep } from './activity-model.js';
import { ActivityTimeline } from './ActivityTimeline.jsx';
import { projectActivityView } from './activity-timeline-projection.js';

export function ActivityMessage({ message, now = Date.now() }) {
  if (isPlaceholderActivityMessage(message)) {
    return null;
  }
  const running = message.status === 'running' || message.status === 'queued';
  const failed = message.status === 'failed';
  const activities = message.activities || [];
  const visibleSteps = activities.filter((activity) => isVisibleActivityStep(activity, message.status));
  const { timeRange, timeline, fileSummary } = projectActivityView(visibleSteps, { running });
  const hasProcess = timeline.length > 0 || Boolean(fileSummary);
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
      <div className={`message-bubble activity-bubble ${failed ? 'is-failed' : ''}`}>
        <button
          type="button"
          className="activity-summary"
          aria-expanded={hasProcess ? open : undefined}
          disabled={!hasProcess}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{duration ? `${headline} ${duration}` : headline}</span>
          {hasProcess ? <ChevronDown className={`activity-chevron ${open ? 'is-open' : ''}`} size={15} /> : null}
        </button>
        {open && hasProcess ? <ActivityTimeline timeline={timeline} fileSummary={fileSummary} /> : null}
      </div>
    </div>
  );
}
