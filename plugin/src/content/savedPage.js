import { SK, articleRecKey } from '../modules/storageKeys.js';
import { pageKeyForUrl } from '../modules/pageKey.js';
import { resolveHighlightSelections } from './highlightSentences.js';
import { extractedBlockText } from './extractor.js';
import { limitPageText } from '../modules/pageInput.js';
import { applyGhostHighlights, clearHighlightElements, getSavedPageHighlights, isAnyHighlightingEnabled, scheduleRestoreAnnotations, setSavedPageHighlights, setPageHighlightsChangedHandler } from './highlighter.js';

// Reconnect saved selections to the page; the existing highlights panel owns all on-page UI.
export function startSavedPageRestore(isBusy = () => false, onMatchesChanged = () => {}) {
  let pageKey = pageKeyForUrl(window.location.href);
  let revision = 0, savedArticle = null, selections = [], matches = [];
  let timer = null, scheduledAt = 0;
  let lastPublished = '';
  const getHighlightState = () => savedArticle && pageKey === pageKeyForUrl(window.location.href)
    ? { articleId: savedArticle.id, url: window.location.href, highlights: getSavedPageHighlights() } : null;
  setPageHighlightsChangedHandler(() => {
    const state = getHighlightState();
    const serialized = JSON.stringify(state);
    if (serialized === lastPublished) return;
    lastPublished = serialized;
    if (state) onMatchesChanged(state);
  });
  const get = keys => new Promise(resolve => {
    try {
      chrome.storage.local.get(keys, result => {
        void chrome.runtime.lastError;
        resolve(result || {});
      });
    } catch (_) { resolve({}); }
  });
  const eligible = selection => selection && typeof selection.text === 'string' && selection.text.trim()
    && !['source-unmatched', 'source-ambiguous', 'invalid-response'].includes(selection.status);
  const reconnect = () => {
    if (isBusy() || pageKey !== pageKeyForUrl(window.location.href) || !savedArticle) return;
    const texts = selections.filter(eligible).map(selection => selection.text);
    const painted = isAnyHighlightingEnabled() ? applyGhostHighlights(texts) : texts.map(text => ({ text, status: 'disabled' }));
    const byText = new Map(painted.map(match => [match.text, match.status]));
    matches = selections.map(selection => eligible(selection)
      ? { ...selection, status: byText.get(selection.text) || 'unavailable' } : selection);
    setSavedPageHighlights(matches, true);
    scheduleRestoreAnnotations(0);
  };
  const restore = async () => {
    const key = pageKeyForUrl(window.location.href);
    if (key !== pageKey) {
      pageKey = key;
      savedArticle = null;
      selections = matches = [];
      setSavedPageHighlights();
      clearHighlightElements();
    }
    const request = ++revision;
    const data = await get([SK.articlesIndex]);
    if (request !== revision || key !== pageKeyForUrl(window.location.href) || isBusy()) return;
    const candidates = (Array.isArray(data[SK.articlesIndex]) ? data[SK.articlesIndex] : [])
      .filter(article => article && article.id && !article.savedOnly && !article.feedStub
        && typeof article.url === 'string' && pageKeyForUrl(article.url) === key)
      .reverse().sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
    const article = candidates[0];
    if (!article) {
      savedArticle = null;
      selections = matches = [];
      setSavedPageHighlights();
      return;
    }
    if (article.id === savedArticle?.id) { reconnect(); return; }
    const records = await get([articleRecKey(article.id)]);
    if (request !== revision || key !== pageKeyForUrl(window.location.href) || isBusy()) return;
    const record = records[articleRecKey(article.id)];
    if (!record) return;
    savedArticle = { ...article, ...record };
    selections = Array.isArray(record.highlights) ? record.highlights.map(selection => typeof selection === 'string' ? { text: selection } : selection).filter(Boolean) : [];
    const needsRecovery = selection => ['source-unmatched', 'source-ambiguous'].includes(selection.status)
      || (selection.status === 'unmatched' && typeof selection.prefix === 'string');
    if (selections.some(needsRecovery)) {
      let source = record.analysisSource;
      if (!source || typeof source.text !== 'string') {
        // Older records lack the analyzed source. The former fixed cap was 80,000
        // characters; keep legacy repair within that conservative scope.
        const doc = new DOMParser().parseFromString(record.content || '', 'text/html');
        doc.querySelectorAll('script, style, noscript, template').forEach(node => node.remove());
        const text = extractedBlockText(doc.body);
        const capped = limitPageText(text, 80000);
        source = { text: capped, truncated: capped.length < text.length };
      }
      const failed = selections.filter(needsRecovery);
      const recovered = resolveHighlightSelections(failed.map(selection => selection.prefix || selection.text), source.text, record.meta?.contentLang, !!source.truncated);
      const byPrefix = new Map(recovered.filter(selection => selection.prefix).map(selection => [selection.prefix, selection]));
      let repaired = false;
      selections = selections.map(selection => {
        if (!needsRecovery(selection)) return selection;
        const prefix = selection.prefix || selection.text;
        const result = typeof prefix === 'string' ? byPrefix.get(prefix.replace(/\s+/gu, ' ').trim()) : null;
        if (!result || result.status !== 'resolved') return selection;
        // A page-only failure needs repair only when source recovery changes the span.
        if (selection.status === 'unmatched' && result.text === selection.text) return selection;
        repaired = true;
        return { ...selection, ...result };
      });
      if (repaired) {
        savedArticle.highlights = selections;
        // Repair only source recovery; page matching still runs against the live DOM below.
        const write = chrome.storage.local.set({ [articleRecKey(article.id)]: { ...record, highlights: selections } });
        if (write?.catch) write.catch(() => {});
      }
    }
    reconnect();
  };
  const schedule = () => {
    if (!timer) scheduledAt = Date.now();
    else clearTimeout(timer);
    timer = setTimeout(() => { timer = null; restore(); }, Date.now() - scheduledAt >= 1000 ? 0 : 120);
  };
  const onNav = () => { if (document.visibilityState !== 'hidden') schedule(); };
  const onStorage = (changes, area) => {
    if (area === 'local' && (changes[SK.articlesIndex] || (savedArticle && changes[articleRecKey(savedArticle.id)]))) {
      if (savedArticle && changes[articleRecKey(savedArticle.id)]) savedArticle = null;
      schedule();
    }
    if (area === 'sync' && (changes.highlightingEnabled || changes.aiHighlightingEnabled || changes.userHighlightingEnabled || changes.highlightExcludedSites)) schedule();
  };
  const observer = new MutationObserver(mutations => {
    if (!matches.some(match => eligible(match) && ['unmatched', 'ambiguous', 'unavailable'].includes(match.status))) return;
    const pageChanged = mutations.some(mutation => {
      if (mutation.target.parentElement?.closest('[data-aish-ui="1"]') || mutation.target.closest?.('[data-aish-ui="1"]')) return false;
      if (mutation.type === 'characterData') return true;
      return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
        node.nodeType !== Node.ELEMENT_NODE || (!node.matches('[data-aish-ui="1"], .ai-ghost-highlight, .ai-user-highlight') && node.id !== 'aish-hl-styles'));
    });
    if (pageChanged) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('visibilitychange', onNav);
  window.addEventListener('popstate', onNav);
  window.addEventListener('hashchange', onNav);
  window.navigation?.addEventListener('navigatesuccess', onNav);
  chrome.storage.onChanged.addListener(onStorage);
  const watcher = window.setInterval(() => {
    try { if (chrome.runtime.id) { if (pageKey !== pageKeyForUrl(window.location.href)) schedule(); return; } } catch (_) { /* extension reloaded */ }
    observer.disconnect();
    clearTimeout(timer);
    window.clearInterval(watcher);
    document.removeEventListener('visibilitychange', onNav);
    window.removeEventListener('popstate', onNav);
    window.removeEventListener('hashchange', onNav);
    window.navigation?.removeEventListener('navigatesuccess', onNav);
    try { chrome.storage.onChanged.removeListener(onStorage); } catch (_) { /* context gone */ }
  }, 700);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  return {
    getArticle: () => savedArticle,
    getHighlightState,
    remember: article => {
      if (!article?.id || pageKeyForUrl(article.url) !== pageKeyForUrl(window.location.href)) return;
      revision++;
      pageKey = pageKeyForUrl(window.location.href);
      savedArticle = article;
      selections = matches = Array.isArray(article.highlights) ? article.highlights : [];
      setSavedPageHighlights(matches, true);
    }
  };
}
