export function isImageAttachment(attachment = {}) {
  const mimeType = String(attachment.mimeType || '').toLowerCase();
  return attachment.kind === 'image' || mimeType.startsWith('image/');
}

export function attachmentPreviewUrl(attachment = {}, token = '') {
  const imagePath = String(attachment.path || '').trim();
  if (!imagePath) {
    return '';
  }
  const tokenValue = String(token || '').trim();
  const tokenParam = tokenValue ? `&token=${encodeURIComponent(tokenValue)}` : '';
  return `/api/local-image?path=${encodeURIComponent(imagePath)}${tokenParam}`;
}
