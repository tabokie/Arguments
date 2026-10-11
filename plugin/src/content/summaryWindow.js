import { sanitizeHtml } from './markdown.js';
import { renderHighlights } from '../modules/highlightView.js';

// Shadow DOM keeps the summary readable independently of the visited page's styles.
export function showSummaryWindow(html, highlights = []) {
  document.getElementById('aish-summary-window')?.remove();
  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  host.id = 'aish-summary-window';
  host.setAttribute('data-aish-ui', '1');
  host.style.cssText = `all:initial !important;position:fixed !important;
    right:16px !important;bottom:16px !important;
    width:min(420px, calc(100vw - 32px)) !important;z-index:2147483647 !important;`;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      --bg-page: #faf8ff; --text-primary: #0f172a; --text-muted: #566274;
      --outline: rgba(100,116,139,0.25); --accent: #2563eb;
      --failure-text: #9a3412; --failure-bg: #fff0df;
      --shadow-modal: 0 12px 40px rgba(15,23,42,0.16);
      --radius-lg: 16px; --radius-xs: 6px;
      --spacing-s-3: 12px; --spacing-s-4: 16px; --fs-base: 14px;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg-page: #0b0e14; --text-primary: #e8edf5; --text-muted: #94a3b8;
        --outline: rgba(255,255,255,0.10); --accent: #60a5fa;
        --failure-text: #fdba74; --failure-bg: #352317;
        --shadow-modal: 0 12px 40px rgba(0,0,0,0.55);
      }
    }
    * { box-sizing: border-box; }
    section {
      display: flex; flex-direction: column; max-height: min(60vh, calc(100vh - 32px));
      max-height: min(60dvh, calc(100dvh - 32px)); overflow: hidden;
      background: var(--bg-page); color: var(--text-primary);
      border: 1px solid var(--outline); border-radius: var(--radius-lg);
      box-shadow: var(--shadow-modal); font: var(--fs-base)/1.6 system-ui, sans-serif;
      text-align: start;
    }
    header {
      display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
      gap: var(--spacing-s-3); padding: var(--spacing-s-3) var(--spacing-s-4);
      border-bottom: 1px solid var(--outline);
    }
    header h2 { margin: 0; font: inherit; font-weight: 600; }
    button {
      display: grid; place-items: center; width: 32px; height: 32px; padding: 0;
      border: 0; border-radius: var(--radius-xs); background: transparent;
      color: var(--text-muted); font: inherit; font-size: 22px; cursor: pointer;
    }
    button:hover { background: var(--outline); color: var(--text-primary); }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .body { min-height: 0; overflow: auto; overscroll-behavior: contain;
      padding: var(--spacing-s-4); overflow-wrap: anywhere; }
    .body > :first-child { margin-top: 0; }
    .body > :last-child { margin-bottom: 0; }
    .body h1, .body h2, .body h3 { font-size: 1.15em; line-height: 1.4; }
    .body p, .body ul { margin: 0 0 var(--spacing-s-3); }
    .body ul { padding-inline-start: 1.5em; }
    .highlights { margin-top: var(--spacing-s-4); padding-top: var(--spacing-s-3);
      border-top: 1px solid var(--outline); }
    .highlights summary { cursor: pointer; font-weight: 600; }
    .highlights ul { margin: var(--spacing-s-3) 0 0; }
    .highlights li + li { margin-top: var(--spacing-s-3); }
    .match-status { display: inline-block; font-size: 12px; font-weight: 500;
      color: var(--text-muted); margin-inline-start: 6px; }
    li .match-status { display: block; margin: 4px 0 0; }
    .match-status.failure { color: var(--failure-text); background: var(--failure-bg);
      padding: 1px 6px; border-radius: var(--radius-xs); }
  `;
  const panel = document.createElement('section');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'aish-summary-window-title');
  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.id = 'aish-summary-window-title';
  title.textContent = chrome.i18n?.getMessage('summary') || 'Summary';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', chrome.i18n?.getMessage('f_close_acc3') || 'Close');
  const dismiss = () => {
    const hadFocus = document.activeElement === host;
    host.remove();
    if (hadFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  close.addEventListener('click', dismiss);
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
  });
  const body = document.createElement('div');
  body.className = 'body';
  body.tabIndex = 0;
  body.innerHTML = sanitizeHtml(html);
  const disclosure = renderHighlights(highlights);
  if (disclosure) body.appendChild(disclosure);
  header.append(title, close);
  panel.append(header, body);
  root.append(style, panel);
  document.documentElement.appendChild(host);
  return host;
}
