function clean(value) {
  return String(value || '').trim();
}

function nextSyncedValue({ currentValue, previousStatusValue, statusValue, fallbackValue = '' }) {
  const current = clean(currentValue);
  const previous = clean(previousStatusValue);
  const status = clean(statusValue);

  if (!status) {
    return current || previous || clean(fallbackValue);
  }
  if (!current || !previous || current === previous || current === status || status !== previous) {
    return status;
  }
  return current;
}

export function nextSyncedComposerSettings({
  currentModel,
  previousStatusModel,
  statusModel,
  fallbackModel = 'gpt-5.5',
  currentReasoningEffort,
  previousStatusReasoningEffort,
  statusReasoningEffort,
  fallbackReasoningEffort = 'xhigh'
} = {}) {
  return {
    model: nextSyncedValue({
      currentValue: currentModel,
      previousStatusValue: previousStatusModel,
      statusValue: statusModel,
      fallbackValue: fallbackModel
    }),
    reasoningEffort: nextSyncedValue({
      currentValue: currentReasoningEffort,
      previousStatusValue: previousStatusReasoningEffort,
      statusValue: statusReasoningEffort,
      fallbackValue: fallbackReasoningEffort
    })
  };
}
