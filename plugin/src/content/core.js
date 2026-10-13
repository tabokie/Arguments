import { SK, articleRecKey } from '../modules/storageKeys.js';
import { debug } from '../modules/log.js';
// content/core.js
// Core helpers for the content script: page metadata collection,
// storage saving, and the Safari-safe streaming port connection.

function countWords(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

/**
 * Save an article to local storage.
 *
 * Storage is split into a small 'articlesIndex' (everything list/search/
 * graph/analytics views need) plus one 'article:<id>' record per article
 * (full content, loaded only when that article is opened) — see
 * StorageManager.saveArticle() in modules/storageManager.js, which this
 * mirrors. Content scripts can't import that module (the build's content
 * script bundler only inlines relative imports under src/content/, and
 * doesn't resolve modules/storageManager.js's default export), so the same
 * shape is written by hand here via raw chrome.storage.local calls.
 */
/** Page metadata worth keeping with a summary (shown again when the conversation is resumed). All fields optional, capped. */
export function collectPageMeta(doc = document, loc = window.location) {
  const cap = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const attr = (sel, a = 'content') => { const el = doc.querySelector(sel); return el ? el.getAttribute(a) || '' : ''; };
  const abs = (u) => { try { return u ? new URL(u, loc.href).href : ''; } catch (_) { return ''; } };
  const iconEl = doc.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
  const meta = {
    description: cap(attr('meta[name="description"]') || attr('meta[property="og:description"]') || attr('meta[name="twitter:description"]'), 400),
    favicon: cap(abs(iconEl ? iconEl.getAttribute('href') : '') || (loc.origin && loc.origin !== 'null' ? loc.origin + '/favicon.ico' : ''), 400),
    siteName: cap(attr('meta[property="og:site_name"]'), 80),
    image: cap(abs(attr('meta[property="og:image"]')), 400),
    author: cap(attr('meta[name="author"]') || attr('meta[property="article:author"]'), 120),
    published: cap(attr('meta[property="article:published_time"]') || attr('meta[name="date"]'), 40),
    lang: cap(doc.documentElement ? doc.documentElement.getAttribute('lang') : '', 20)
  };
  Object.keys(meta).forEach(k => { if (!meta[k]) delete meta[k]; });
  return meta;
}

export function saveToLocalStorage(content, summary, url, title, description, tags = [], modelId = '', summaryLength = 200, _moodScore, extra, pageMeta, highlights = [], analysisSource) {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString();
    const id = `article_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // lastOpened starts equal to the save time: a freshly saved article is
    // by definition "opened" the moment it's created, so it shouldn't be
    // flagged as neglected until it's actually sat unopened for a while.
    const indexEntry = {
      id, title: title || 'Untitled', url, timestamp, tags, modelId, summaryLength,
      summary: summary || '',
      contentWordCount: countWords(content || ''),
      summaryWordCount: countWords(summary || ''),
      archived: false,
      lastOpened: timestamp
    };
    if (pageMeta && pageMeta.favicon) indexEntry.favicon = pageMeta.favicon;   // lean: lists can show it without loading the record
    if (extra && typeof extra === 'object') Object.assign(indexEntry, extra);
    const record = { content, summary, description: description || (pageMeta && pageMeta.description) || '' };
    if (analysisSource && typeof analysisSource.text === 'string') record.analysisSource = { text: analysisSource.text, truncated: !!analysisSource.truncated };
    if (highlights.length) record.highlights = highlights;
    if (pageMeta && Object.keys(pageMeta).length) record.meta = pageMeta;

    chrome.storage.local.get({ [SK.articlesIndex]: [] }, (data) => {
      const articlesIndex = data[SK.articlesIndex] || [];
      articlesIndex.push(indexEntry);
      chrome.storage.local.set({ [SK.articlesIndex]: articlesIndex, [articleRecKey(id)]: record }, () => {
        const articleData = { ...indexEntry, ...record };
        debug('Article saved to local storage');
        resolve(articleData);
      });
    });
  });
}

export function extractSummaryTitle(html) {
  const match = (html || '').match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (!match) return '';
  return match[1].replace(/<[^>]+>/g, '').trim();
}
