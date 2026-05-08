function fileKey(file) {
  return [
    file?.name || '',
    file?.size ?? '',
    file?.type || ''
  ].join(':');
}

export function filesFromClipboardData(clipboardData) {
  if (!clipboardData) {
    return [];
  }

  const files = [];
  const seen = new Set();
  const addFile = (file) => {
    if (!file) {
      return;
    }
    const key = fileKey(file);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    files.push(file);
  };

  for (const file of Array.from(clipboardData.files || [])) {
    addFile(file);
  }

  for (const item of Array.from(clipboardData.items || [])) {
    if (item?.kind !== 'file' || typeof item.getAsFile !== 'function') {
      continue;
    }
    addFile(item.getAsFile());
  }

  return files;
}
