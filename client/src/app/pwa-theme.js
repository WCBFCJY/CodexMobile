export const PWA_THEME_META = {
  light: {
    themeColor: '#f7f7f4',
    statusBarStyle: 'default'
  },
  dark: {
    themeColor: '#000000',
    statusBarStyle: 'black-translucent'
  }
};

export function normalizePwaTheme(theme) {
  return theme === 'dark' ? 'dark' : 'light';
}

export function applyPwaTheme(theme, doc = globalThis.document) {
  const normalizedTheme = normalizePwaTheme(theme);
  const meta = PWA_THEME_META[normalizedTheme];

  if (!doc) {
    return meta;
  }

  if (doc.documentElement?.dataset) {
    doc.documentElement.dataset.theme = normalizedTheme;
  }

  doc.querySelector?.('meta[data-app-theme-color]')?.setAttribute?.('content', meta.themeColor);
  doc.querySelector?.('meta[data-app-status-bar-style]')?.setAttribute?.('content', meta.statusBarStyle);

  return meta;
}
