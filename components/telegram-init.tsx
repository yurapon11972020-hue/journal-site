'use client';

import { useEffect } from 'react';

type TgWebApp = {
  initData?: string;
  platform?: string;
  colorScheme?: string;
  ready: () => void;
  expand: () => void;
  onEvent: (event: string, callback: () => void) => void;
};

function getTelegram(): TgWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
}

// Стили применяются только когда страница открыта как Telegram Mini App
// (на обычном сайте атрибута data-tg-webapp нет, поэтому ничего не меняется).
const TG_CSS = `
html[data-tg-webapp] {
  --bg: var(--tg-theme-secondary-bg-color, #0f1728);
  --panel: var(--tg-theme-bg-color, #162033);
  --panel-alt: var(--tg-theme-section-bg-color, var(--tg-theme-bg-color, #1b2740));
  --text: var(--tg-theme-text-color, #eef3ff);
  --muted: var(--tg-theme-hint-color, #a9b6cf);
  --accent: var(--tg-theme-button-color, #78a7ff);
  --accent-strong: var(--tg-theme-link-color, #a9c4ff);
  --border: color-mix(in srgb, var(--tg-theme-hint-color, #5b6b86) 26%, transparent);
}
html[data-tg-webapp] body {
  background: var(--bg);
}
html[data-tg-webapp] .page-shell {
  width: 100%;
  padding: 12px 12px 36px;
}
html[data-tg-webapp] .page-header {
  margin-bottom: 14px;
}
html[data-tg-webapp] .page-header .theme-toggle {
  display: none;
}
html[data-tg-webapp] .page-header .eyebrow {
  color: var(--accent-strong);
  font-weight: 600;
  letter-spacing: 0.02em;
}
html[data-tg-webapp] .page-title {
  font-size: clamp(1.5rem, 6vw, 2rem);
}
html[data-tg-webapp] .sheet-card,
html[data-tg-webapp] .subject-section,
html[data-tg-webapp] .empty-state,
html[data-tg-webapp] .lesson-topic-card {
  border-radius: 16px;
}
html[data-tg-webapp] .tab-chip {
  border-radius: 14px;
}
`;

export default function TelegramInit() {
  useEffect(() => {
    if (!document.getElementById('tg-webapp-style')) {
      const style = document.createElement('style');
      style.id = 'tg-webapp-style';
      style.textContent = TG_CSS;
      document.head.appendChild(style);
    }

    function apply() {
      const tg = getTelegram();
      if (!tg || typeof tg.initData !== 'string' || !tg.platform || tg.platform === 'unknown') {
        return;
      }

      try {
        tg.ready();
        tg.expand();
      } catch {
        // ignore
      }

      const root = document.documentElement;
      root.dataset.tgWebapp = '1';

      const applyScheme = () => {
        if (tg.colorScheme === 'light' || tg.colorScheme === 'dark') {
          root.dataset.theme = tg.colorScheme;
        }
      };

      applyScheme();

      try {
        tg.onEvent('themeChanged', applyScheme);
      } catch {
        // ignore
      }
    }

    if (getTelegram()) {
      apply();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.async = true;
    script.onload = apply;
    document.head.appendChild(script);
  }, []);

  return null;
}
