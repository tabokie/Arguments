import { renderHighlights } from './highlightView.js';
import { t } from './i18n.js';
import { mountReadingTools, destroyReadingTools } from './readingTools.js';
import { showSkeleton, clearSkeleton } from './skeleton.js';
import { modelIcon } from './modelBadge.js';
import { icon, setIconLabel, stripEmoji } from './icons.js';
import { SK } from './storageKeys.js';
import { escapeHtml, cleanUntrustedHtml } from './textUtils.js';
// Article Manager
// Handles article rendering, expand/collapse, search, etc.

import StorageManager from './storageManager.js';
import { syncTabbarLater } from './tabbar.js';
import { sendToLocalSend } from './localSendClient.js';
import { buildIndex, search as tfidfSearch, similarTo } from './localSearch.js';
import { computeMetrics } from './textMetrics.js';
import { initSelection, registerCard, toggleCard, selectionActive, canSelect, startSelectionWith } from './sendSheet.js';
import { attachCardMenu } from './cardMenu.js';
import { T, locale } from './feedI18n.js';

import { withQuestions, qaMarkdown } from './conversation.js';
import { qaSection } from './qaView.js';
import { buildAnnotationsSection, fetchAnnotationsForArticle, buildAnnotationsPlainText, markHighlights } from './annotationExporter.js';

// Escapes translated text for use inside double-quoted HTML attributes.
const escAttr = escapeHtml;
/** Translated label whose translations still carry the old emoji, text only (the control gets an SVG icon). */
const lbl = (key) => escapeHtml(stripEmoji(T(key)));

let uiManagerRef = null;
let currentDetailArticle = null;
let cachedArticles = [];          // not archived: graph, search and the Inbox/Read/Sent tabs read from here
let archivedCache = [];           // archived entries (Archive tab)
let historyTab = 'inbox';         // 'inbox' | 'read' | 'sent' | 'archive'
let pendingRender = false;

const isSent = (a) => Array.isArray(a.sentTo) && a.sentTo.length > 0;
const TAB_DEFS = [['inbox', () => T('Inbox')], ['read', () => T('Read')], ['sent', () => T('Sent')], ['archive', () => T('Archive')]];

function tabList(tab) {
    if (tab === 'read') return cachedArticles.filter(a => a.readAt);
    if (tab === 'sent') return cachedArticles.filter(isSent);
    if (tab === 'archive') return archivedCache;
    return cachedArticles;
}

export const currentHistoryTab = () => historyTab;

/** Re-render the list for the active tab (Inbox = everything not archived). */
export function renderTab() { renderArticles(tabList(historyTab)); }

// One persistent bar (like Feeds' scope row): re-attached on every render, updated in place,
// so the brand indicator slides between tabs instead of being rebuilt.
let historyNav = null;
function buildTabs() {
    if (!historyNav) {
        const nav = document.createElement('div');
        nav.className = 'history-tabs tabbar';
        nav.dataset.tabbar = 'history';
        nav.setAttribute('role', 'tablist');
        TAB_DEFS.forEach(([id]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'history-tab tabbar-btn';
            b.setAttribute('role', 'tab');
            b.dataset.tab = id;
            b.append(document.createElement('span'), Object.assign(document.createElement('span'), { className: 'history-tab-n tabbar-n' }));
            b.addEventListener('click', () => { if (historyTab === id) return; historyTab = id; renderTab(); const f = document.getElementById('searchInput'); if (f && f.value.trim()) filterArticles(); });
            nav.appendChild(b);
        });
        historyNav = nav;
    }
    const nav = historyNav;
    TAB_DEFS.forEach(([id, label]) => {
        const b = nav.querySelector(`.tabbar-btn[data-tab="${id}"]`);
        if (!b) return;
        b.classList.toggle('on', historyTab === id);
        b.setAttribute('aria-selected', String(historyTab === id));
        b.firstChild.textContent = label();
        b.lastChild.textContent = String(tabList(id).length);
    });
    syncTabbarLater(nav);
    return nav;
}

function fmtDay(iso) { try { return new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }); } catch (_) { return ''; } }

/** [tone, text] badges for a card: Sent (per target) else Read else New; Archived is added first. */
export function statusBadges(a) {
    if (!a || a.feedStub) return [];
    const out = [];
    if (a.savedOnly && !(a.summary && String(a.summary).trim())) out.push(['saved', T('📥 Saved · no AI')]);
    if (a.archived) out.push(['arch', T('🗄️ Archived · {date}', { date: fmtDay(a.archivedAt || a.timestamp) })]);
    const latest = new Map();
    (isSent(a) ? a.sentTo : []).forEach(x => latest.set(x.kind + '|' + (x.label || ''), x));
    [...latest.values()].sort((x, y) => String(x.at).localeCompare(String(y.at))).slice(-2).forEach(x => {
        const date = fmtDay(x.at);
        out.push(['sent', x.kind === 'kindle' ? T('📚 Sent to Kindle · {date}', { date }) : x.kind === 'localsend' ? T('📡 Sent via LocalSend · {date}', { date }) : T('✅ Sent · {date}', { date })]);
    });
    if (!isSent(a)) out.push(a.readAt ? ['read', T('👀 Read')] : ['new', T('🆕 New')]);
    return out;
}

/**
 * Change reading status for several articles (storage + caches + list).
 * patch: { read?, sent?: {kind,label}, archived? } — see StorageManager.patchArticleStatus.
 */
export async function applyStatus(ids, patch) {
    await StorageManager.patchArticleStatus(ids, patch);
    const all = await StorageManager.getArticlesIndex({ includeArchived: true });
    cachedArticles = all.filter(a => !a.archived);
    archivedCache = all.filter(a => a.archived);
    invalidateSearchIndex();
    const list = document.getElementById('articleList');
    if (list && list.style.display !== 'none') renderTab(); else pendingRender = true;
}

// Archive text index, rebuilt only when saved articles change.
let searchIndex = null;
let searchIndexDirty = true;

function invalidateSearchIndex() {
    searchIndexDirty = true;
}

/**
 * Records that an article was opened (viewed in the detail view). This is
 * the "follow-through" signal the knowledge graph uses to surface neglected
 * saves — an article that sits unopened past the threshold fades/shrinks
 * in the graph. Persisted to storage so it survives reloads.
 */
function recordArticleOpened(article) {
    if (!article || !article.id) return;
    const now = new Date().toISOString();
    article.lastOpened = now;
    // Keep the in-memory cache in sync so the graph (which reads from
    // cachedArticles) reflects the update immediately.
    const idx = cachedArticles.findIndex(a => a.id === article.id);
    if (idx !== -1) cachedArticles[idx].lastOpened = now;
    StorageManager.touchArticleOpened(article.id).catch(() => {});
}

function ensureSearchIndex() {
    if (!searchIndex || searchIndexDirty) {
        searchIndex = buildIndex(cachedArticles);
        searchIndexDirty = false;
    }
    return searchIndex;
}

function buildSafeArticleTitle(title) {
    return (title || 'Arguments').replace(/[^a-z0-9_-]/gi, '_');
}

async function includeAllQuestions() {
    try { return !!(await StorageManager.getLocal({ [SK.exportAllQuestions]: false }))[SK.exportAllQuestions]; } catch (_) { return false; }
}
async function conversationOf(article) {
    return Array.isArray(article.conversation) ? article.conversation : (article.id ? StorageManager.getConversation(article.id) : []);
}
/** Article copy whose summary also carries the pinned questions (all of them when "Include all questions" is on). */
async function exportView(article) {
    const turns = await conversationOf(article);
    if (!turns.length) return article;
    let base = article.summaryBase;
    if (base === undefined && article.id) {   // lean index entries already carry the pinned block: start from the original text
        try { const full = await StorageManager.getArticleFull(article.id); base = full.summaryBase !== undefined ? full.summaryBase : full.summary; } catch (_) { /* fall back below */ }
    }
    return { ...article, summary: withQuestions(base !== undefined ? base : article.summary, turns, { all: await includeAllQuestions() }) };
}

async function buildArticleDocumentHtml(article) {
    article = await exportView(article);
    // Include the article's highlights & AI suggested highlights (ghosts
    // included even if never marked "keep").
    const annotations = await fetchAnnotationsForArticle(article);
    const annotationsHtml = await buildAnnotationsSection(article, annotations);
    // One pass over the document: a highlight is marked once (full text wins over the summary).
    const placed = new Set();
    const contentHtml = markHighlights(article.content, annotations, placed);
    const summaryHtml = markHighlights(article.summary, annotations, placed);
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(article.title || 'Arguments')}</title>
<style>body{font-family:sans-serif;line-height:1.6;padding:20px;max-width:800px;margin:auto;}h1{border-bottom:2px solid #333;padding-bottom:5px;}.meta{color:#555;font-style:italic;}.summary{background:#f8f9fa;padding:15px;border-left:4px solid #0284c7;margin:20px 0;}img{max-width:100%;height:auto;}</style>
</head><body><h1>${escapeHtml(article.title || 'Arguments')}</h1>
<div class="meta">Captured via Arguments &middot; <a href="${escAttr(article.url || '#')}">Source</a></div>
${summaryHtml ? `<div class="summary"><h2>🧙 Main output</h2>${summaryHtml}</div>` : ''}
${annotationsHtml}
${contentHtml ? `<h2>📄 Content</h2><div>${contentHtml}</div>` : ''}</body></html>`;
}

export const __test_buildDoc = (a) => buildArticleDocumentHtml(a);

async function buildArticleHtmlFile(article) {
    const safeTitle = buildSafeArticleTitle(article.title);
    const fileName = `${safeTitle}.html`;
    const docHtml = await buildArticleDocumentHtml(article);
    const blob = new Blob([docHtml], { type: 'text/html' });
    const file = new File([blob], fileName, { type: 'text/html' });
    return { file, fileName, docHtml };
}

/**
 * Triggers the native OS share sheet
 */
export async function shareArticle(article) {
    if (!navigator.share) {
        if (uiManagerRef) uiManagerRef.showToast(T('Sharing is not supported in this browser/environment.'));
        else alert(T('Sharing is not supported in this browser/environment.'));
        return;
    }

    try {
        const { file } = await buildArticleHtmlFile(article);
        const fileShareData = {
            title: article.title || 'Arguments',
            files: [file]
        };

        // Prefer file sharing so AirDrop imports as an offline document.
        if (navigator.canShare && navigator.canShare(fileShareData)) {
            await navigator.share(fileShareData);
            if (uiManagerRef) uiManagerRef.showToast(T('File shared successfully.'));
            return;
        }

        // Fallback for environments that only support URL/text share.
        await navigator.share({
            title: article.title || 'Arguments',
            text: `Check out these arguments: \n\n${article.summary || ''}\n\nRead more at:`,
            url: article.url || ''
        });
    } catch (err) {
        console.error('Share failed:', err);
        if (uiManagerRef && err?.name !== 'AbortError') {
            uiManagerRef.showToast(T('Share failed: {message}', { message: err?.message || T('Unknown error') }));
        }
    }
}
/**
 * Generates and downloads a Markdown file with YAML Frontmatter
 */
export async function exportToMarkdown(article) {
    // 1. Format date as YYYY-MM-DD for Obsidian frontmatter
    const createdDate = new Date(article.timestamp).toISOString().split('T')[0];

    // 2. Sanitize title for YAML (escape double quotes)
    const safeTitle = (article.title || 'Untitled Article').replace(/"/g, '\\"');

    const yamlStr = (v) => v ? `"${String(v).replace(/"/g, '\\"')}"` : '';

    // 4. Construct the YAML Frontmatter
    const frontmatter = `---
title: "${safeTitle}"
source: "${article.url || ''}"
author: ${yamlStr(article.meta?.author || '')}
published: ${yamlStr(article.meta?.published || '')}
created: ${createdDate}
description: 
bookrecs: 
why: 
---`;

    // 5. Construct the Markdown Body — convert vanilla <img> and <a> to Markdown
    const baseSummary = article.summaryBase !== undefined ? article.summaryBase : article.summary;
    const summaryPlain = baseSummary ? baseSummary.replace(/<[^>]+>/g, '').trim() : '';

    // Parse stored clean HTML and convert tags to Markdown syntax
    const parser = new DOMParser();
    const doc = parser.parseFromString(article.content || '', 'text/html');

    // Convert <img> to ![alt](src)
    const images = doc.querySelectorAll('img');
    images.forEach(img => {
        const alt = img.getAttribute('alt') || 'image';
        const src = img.getAttribute('src') || '';
        if (src) {
            const mdSyntax = `\n\n![${alt}](${src})\n\n`;
            img.parentNode.replaceChild(doc.createTextNode(mdSyntax), img);
        } else {
            img.remove();
        }
    });

    // Convert <a> to [text](url)
    const links = doc.querySelectorAll('a');
    links.forEach(link => {
        const text = link.textContent.trim() || 'Link';
        const href = link.getAttribute('href') || '';
        if (href) {
            const mdSyntax = `[${text}](${href})`;
            link.parentNode.replaceChild(doc.createTextNode(mdSyntax), link);
        }
    });

    const contentPlain = doc.body.textContent || 'No content available.';

    // Include the article's highlights & AI suggested highlights (ghosts
    // included even if never marked "keep").
    const annotationsPlain = await buildAnnotationsPlainText(article);

    const qaMd = qaMarkdown(await conversationOf(article), { all: await includeAllQuestions() });
    const mdContent = `${frontmatter}

# Main output
${summaryPlain}
${qaMd ? '\n' + qaMd : ''}
${annotationsPlain}

---

## 📝 Original Content
${contentPlain.trim().replace(/\n{3,}/g, '\n\n')}
`;

    // 6. Generate and trigger download
    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    // Create a safe, clean filename
    const safeFilename = (article.title || 'article').replace(/[^a-z0-9]/gi, '_').toLowerCase();

    a.href = url;
    a.download = `${createdDate}_${safeFilename}_arguments.md`;
    document.body.appendChild(a);
    a.click();

    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Copies summary and content to clipboard as formatted text (HTML) and plain text (Markdown-ish)
 */
export async function copyArticleToClipboard(article) {
    article = await exportView(article);
    const title = article.title || 'Arguments';
    const summary = article.summary || '';
    const content = article.content || '';

    // Fetch annotations (user + ghost) once and reuse for both mime types.
    const annotations = await fetchAnnotationsForArticle(article);
    const annotationsHtml = await buildAnnotationsSection(article, annotations);
    const annotationsPlain = await buildAnnotationsPlainText(article, annotations);

    const placedSet = new Set();
    const contentMarked = markHighlights(content, annotations, placedSet);   // full text first, summary only for the rest
    const summaryMarked = markHighlights(summary, annotations, placedSet);

    // Create a clean HTML version for the clipboard
    const cleanHtml = `
        <div style="font-family: sans-serif;">
            <h1>${escapeHtml(title)}</h1>
            <p><a href="${escAttr(article.url)}">${escapeHtml(article.url)}</a></p>
            <hr>
            <h2>🧙 Main output</h2>
            <div>${summaryMarked}</div>
            ${annotationsHtml ? `<hr><div>${annotationsHtml}</div>` : ''}
            <hr>
            <h2>📄 Original Content</h2>
            <div>${contentMarked}</div>
        </div>
    `.replace(/style="[^"]*"/gi, (match) => {
        // Keep ONLY the top-level font family for the container, strip all other styles
        return match.includes('font-family: sans-serif') ? match : '';
    });

    // Create a plain text / markdown version
    const plainText = `# ${title}\nSource: ${article.url || 'N/A'}\n\n## 🧙 MAIN OUTPUT\n${summary.replace(/<[^>]+>/g, '').trim()}\n\n${annotationsPlain}\n\n---\n\n## 📄 ORIGINAL CONTENT\n${content.replace(/<[^>]+>/g, '').trim()}`;

    try {
        const typeHtml = 'text/html';
        const typePlain = 'text/plain';
        const blobHtml = new Blob([cleanHtml], { type: typeHtml });
        const blobPlain = new Blob([plainText], { type: typePlain });

        const data = [new ClipboardItem({
            [typeHtml]: blobHtml,
            [typePlain]: blobPlain
        })];

        await navigator.clipboard.write(data);
        if (uiManagerRef) uiManagerRef.showToast(T('Copied to clipboard! 📋'));
    } catch (err) {
        console.error('Clipboard copy failed:', err);
        // Fallback for cases where ClipboardItem might fail
        try {
            await navigator.clipboard.writeText(plainText);
            if (uiManagerRef) uiManagerRef.showToast(T('Copied as plain text.'));
        } catch (e) {
            console.error('Final copy fallback failed:', e);
        }
    }
}

/**
 * Sends article summary and content to a Kindle email via the proxy API
 */
export async function sendToKindle(article) {
    article = await exportView(article);
    const config = await StorageManager.getAll();
    // Multiple Kindle devices can be configured; always send to the active
    // one (last used, or the first configured if none has been used yet).
    const device = StorageManager.getActiveDevice(config, 'kindle');
    const kindleEmail = (device?.addresses?.[0] || '').replace(/^mailto:/i, '');
    if (!kindleEmail) {
        if (uiManagerRef) {
            uiManagerRef.showToast(T('Set your Kindle email in Settings first.'));
            uiManagerRef.showScreen('settings');
            import('./settingsNav.js').then(m => m.openSettingsPanel('send', 'newKindleEmail')).catch(() => {});
        } else {
            alert(T('Please configure your Kindle delivery email address inside settings first.'));
        }
        return;
    }

    const isPro = config[SK.user]?.subscription_status === 'active';
    if (!isPro) {
        const confirmation = confirm(T('📚 Send to Kindle\n\nFree tier: 3 Kindle sends included.\nUpgrade to Pro for unlimited.\n\nMake sure kindle@byphil.eu is in your Kindle approved senders list (see Amazon help).\n\nSend this article to Kindle?'));
        if (!confirmation) return;
    }

    // Content now arrives pre-optimized from content capture.
    if (uiManagerRef) {
        uiManagerRef.showToast(T('Preparing Kindle delivery... ⏳'), 3000);
    }

    try {
        const apiBase = StorageManager.getApiBase();
        const headers = { 'Content-Type': 'application/json' };
        if (config[SK.token]) {
            headers['Authorization'] = `Bearer ${config[SK.token]}`;
        } else if (config[SK.licenseKey]) {
            headers['Authorization'] = `Bearer ${config[SK.licenseKey]}`;
        }

        const annotations = await fetchAnnotationsForArticle(article);
        const annotationsHtml = await buildAnnotationsSection(article, annotations);

        const response = await fetch(`${apiBase}/v1/projects/ai_summary_helper/kindle`, {
            method: 'POST',
            headers,
            body: (() => { const kPlaced = new Set(); return JSON.stringify({
                kindle_email: kindleEmail,
                title: article.title || 'Arguments document',
                content: [markHighlights(article.content || article.summary || '', annotations, kPlaced), annotationsHtml].filter(Boolean).join('\n'),
                summary: markHighlights(article.summary || '', annotations, kPlaced),
                url: article.url || ''
            }); })()
        });

        const resData = await response.json();
        if (response.ok && resData.success) {
            if (uiManagerRef) uiManagerRef.showToast(T('Sent to Kindle! 📚'));
            if (device) StorageManager.setActiveDevice('kindle', device.id);
            if (article.id) applyStatus([article.id], { sent: { kind: 'kindle', label: device?.label || '' } }).catch(() => {});
        } else {
            const msg = resData.error || T('Kindle delivery failed.');
            if (resData.error?.includes('Free tier limit') || resData.error?.includes('402')) {
                alert(T('📚 Free tier limit reached (3 sends).\n\nUpgrade to Pro for unlimited Kindle delivery.\n\nhttps://philwornath.com/links'));
            } else if (uiManagerRef) {
                uiManagerRef.showToast(msg);
            } else {
                alert(msg);
            }
        }
    } catch (err) {
        console.error('Kindle dispatch error:', err);
        if (uiManagerRef) uiManagerRef.showToast(T('Network error sending to Kindle.'));
    }
}

export async function dispatchToLocalSend(article) {
    const config = await StorageManager.getAll();
    // Multiple LocalSend receivers can be configured; always send to the
    // active one (last used, or the first configured if none has been used yet).
    const device = StorageManager.getActiveDevice(config, 'localsend');
    const readerIp = (device?.addresses?.[0] || '').trim();

    if (!readerIp) {
        if (uiManagerRef) {
            uiManagerRef.showToast(T('Please set your LocalSend IP in Settings first.'));
            uiManagerRef.showScreen('settings');
            import('./settingsNav.js').then(m => m.openSettingsPanel('send', 'newLocalSendIp')).catch(() => {});
        } else {
            alert(T('Configure your LocalSend IP address inside settings first.'));
        }
        return;
    }

    if (uiManagerRef) uiManagerRef.showToast(T('Sending to LocalSend over Wi-Fi... 🚀'));

    try {
        const { fileName, docHtml } = await buildArticleHtmlFile(article);

        await sendToLocalSend(readerIp, fileName, docHtml, 'text/html');

        if (uiManagerRef) uiManagerRef.showToast(T('Sent successfully! 📖'));
        if (device) StorageManager.setActiveDevice('localsend', device.id);
        if (article.id) applyStatus([article.id], { sent: { kind: 'localsend', label: device?.label || '' } }).catch(() => {});
    } catch (err) {
        console.error('[LocalSend Error]', err);
        if (uiManagerRef) uiManagerRef.showToast(T('Transfer failed: {message}', { message: err?.message || T('Check if receiver is online.') }));
    }
}

/**
 * Non-interactive deliveries used by the History multi-select sheet (sendSheet.js).
 * They return {ok, error?} instead of toasting, so the sheet can show progress per item.
 */
export async function deliverKindle(article, device) {
    article = await exportView(article);
    const config = await StorageManager.getAll();
    const kindleEmail = (device?.addresses?.[0] || '').replace(/^mailto:/i, '');
    if (!kindleEmail) return { ok: false, error: T('No Kindle email set.') };
    try {
        const apiBase = StorageManager.getApiBase();
        const headers = { 'Content-Type': 'application/json' };
        if (config[SK.token]) headers['Authorization'] = `Bearer ${config[SK.token]}`;
        else if (config[SK.licenseKey]) headers['Authorization'] = `Bearer ${config[SK.licenseKey]}`;
        const annotations = article.id ? await fetchAnnotationsForArticle(article) : [];
        const annotationsHtml = article.id ? await buildAnnotationsSection(article, annotations) : '';
        const response = await fetch(`${apiBase}/v1/projects/ai_summary_helper/kindle`, {
            method: 'POST', headers,
            body: (() => { const kPlaced = new Set(); return JSON.stringify({
                kindle_email: kindleEmail,
                title: article.title || 'Arguments document',
                content: [markHighlights(article.content || article.summary || '', annotations, kPlaced), annotationsHtml].filter(Boolean).join('\n'),
                summary: markHighlights(article.summary || '', annotations, kPlaced),
                url: article.url || ''
            }); })()
        });
        const resData = await response.json().catch(() => ({}));
        if (response.ok && resData.success) return { ok: true };
        return { ok: false, error: resData.error || T('Kindle delivery failed.') };
    } catch (err) {
        return { ok: false, error: err?.message || T('Network error') };
    }
}

export async function deliverLocalSend(article, device) {
    const ip = (device?.addresses?.[0] || '').trim();
    if (!ip) return { ok: false, error: T('No receiver address set.') };
    try {
        const { fileName, docHtml } = await buildArticleHtmlFile(article);
        await sendToLocalSend(ip, fileName, docHtml, 'text/html');
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err?.message || T('Check if the receiver is online.') };
    }
}

const wsActive = () => !!document.getElementById('historyScreen')?.classList.contains('ws-active');

/** Keeps every star in sync (list card, detail bar, caches) after a favorite change. */
function paintFavorite(id, on) {
    const c = cachedArticles.find(a => a.id === id); if (c) c.favorite = on;
    const ar = archivedCache.find(a => a.id === id); if (ar) ar.favorite = on;
    if (currentDetailArticle && currentDetailArticle.id === id) currentDetailArticle.favorite = on;
    const li = document.querySelector(`#articleList li[data-id="${CSS.escape(String(id))}"]`);
    if (li) { li.classList.toggle('is-favorite', on); const b = li.querySelector('.star-button'); if (b) { b.setAttribute('aria-pressed', String(on)); } }
    const d = document.getElementById('detailStarBtn');
    if (d && currentDetailArticle && currentDetailArticle.id === id) paintDetailStar(on);
}
function paintDetailStar(on) {
    const d = document.getElementById('detailStarBtn'); if (!d) return;
    d.setAttribute('aria-pressed', String(!!on)); d.classList.toggle('is-on', !!on);
    // the star icon is filled by CSS from aria-pressed / .is-on
}

/** Delete an article after confirming (used by the card ⋯ menu); keeps the History caches in sync. */
export async function removeArticle(article) {
    if (!article || !article.id) return false;
    if (!confirm(T('Are you sure you want to delete this article?'))) return false;
    await StorageManager.deleteArticle(article.id);
    cachedArticles = cachedArticles.filter(i => i.id !== article.id);
    archivedCache = archivedCache.filter(i => i.id !== article.id);
    invalidateSearchIndex();
    if (document.getElementById('articleList')) renderTab();
    if (uiManagerRef) uiManagerRef.showToast(T('Article deleted'));
    return true;
}

export function initArticleManager(uiManager) {
    uiManagerRef = uiManager;
    initSelection({
        deliverKindle, deliverLocalSend,
        applyStatus, currentTab: () => historyTab,
        toast: (m) => uiManager.showToast(m),
        openSettings: (section, target) => { uiManager.showScreen('settings'); import('./settingsNav.js').then(m => m.openSettingsPanel(section, target)).catch(() => {}); }
    });
    {   // re-render the list once it becomes visible again after a status change made elsewhere (detail view)
        const list = document.getElementById('articleList');
        if (list) new MutationObserver(() => { if (pendingRender && list.style.display !== 'none') { pendingRender = false; renderTab(); } }).observe(list, { attributes: true, attributeFilter: ['style'] });
    }
    const searchInput = document.getElementById('searchInput');
    const detailBackBtn = document.getElementById('detailBackButton');
    const detailDeleteBtn = document.getElementById('detailDeleteBtn');
    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');
    const historyScreen = document.getElementById('historyScreen');
    let lastHistoryScrollTop = 0;

    const setTopBarsHidden = (hidden) => {
        if (historyTopBar) historyTopBar.classList.toggle('scroll-hidden', hidden);
        if (detailTopBar) detailTopBar.classList.toggle('scroll-hidden', hidden);
    };

    const deleteCurrentDetailArticle = () => {
        if (!currentDetailArticle) return;
        if (!confirm(T('Are you sure you want to delete this article?'))) return;

        StorageManager.deleteArticle(currentDetailArticle.id).then(() => {
            const deletedId = currentDetailArticle.id;
            const updated = cachedArticles.filter(item => item.id !== deletedId);
            currentDetailArticle = null;
            cachedArticles = updated;
            archivedCache = archivedCache.filter(item => item.id !== deletedId);
            invalidateSearchIndex();
            renderTab();

            const articleDetail = document.getElementById('articleDetail');
            const articleList = document.getElementById('articleList');

            const reportContainer = document.getElementById('reportContainer');
            if (articleDetail) articleDetail.style.display = 'none';

            if (reportContainer && !wsActive()) reportContainer.style.display = 'none';
            if (articleList) articleList.style.display = 'block';
            if (historyTopBar) historyTopBar.style.display = 'flex';
            if (detailTopBar) detailTopBar.style.display = 'none';
        });
    };

    // ── Handle Detail Back Button ───────────────────────────────────────
    if (detailBackBtn) {
        detailBackBtn.addEventListener('click', () => {
            destroyReadingTools();
            const openedId = currentDetailArticle && currentDetailArticle.id;
            const articleDetail = document.getElementById('articleDetail');
            const articleList = document.getElementById('articleList');

            const reportContainer = document.getElementById('reportContainer');
            if (articleDetail) articleDetail.style.display = 'none';

            if (reportContainer && !wsActive()) reportContainer.style.display = 'none';
            if (articleList) articleList.style.display = 'block';
            if (historyTopBar) historyTopBar.style.display = 'flex';
            if (detailTopBar) detailTopBar.style.display = 'none';
            restoreCardFocus(openedId);
        });
    }

    if (detailDeleteBtn) {
        detailDeleteBtn.addEventListener('click', deleteCurrentDetailArticle);
    }
    {   // ★ favorite from the article view
        const ds = document.getElementById('detailStarBtn');
        if (ds) { ds.title = T('Favorite'); ds.setAttribute('aria-label', T('Favorite')); }
        if (ds) ds.addEventListener('click', async () => {
            const a = currentDetailArticle; if (!a || !a.id) return;
            const next = await StorageManager.toggleFavorite(a.id);
            if (next === null) return;
            a.favorite = next; paintFavorite(a.id, next);
            if (uiManagerRef) uiManagerRef.showToast(next ? T('Added to favorites') : T('Removed from favorites'));
        });
    }
    {   // ⋯ menu in the detail top bar: Graph / Analytics / Delete
        const moreBtn = document.getElementById('detailMoreBtn');
        const moreMenu = document.getElementById('detailMoreMenu');
        if (moreBtn && moreMenu) {
            const setOpen = (open) => { moreMenu.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); };
            moreBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(moreMenu.hidden); });
            moreMenu.addEventListener('click', () => setOpen(false));
            document.addEventListener('click', (e) => { if (!moreMenu.hidden && !moreMenu.contains(e.target)) setOpen(false); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !moreMenu.hidden) { setOpen(false); moreBtn.focus(); } });
        }
    }

    if (historyScreen) {
        historyScreen.addEventListener('scroll', () => {
            const currentTop = Math.max(0, historyScreen.scrollTop);
            const delta = currentTop - lastHistoryScrollTop;

            if (currentTop <= 8) {
                setTopBarsHidden(false);
            } else if (delta > 6) {
                setTopBarsHidden(true);
            } else if (delta < -4) {
                setTopBarsHidden(false);
            }

            lastHistoryScrollTop = currentTop;
        }, { passive: true });
    }

    if (searchInput) {
        searchInput.addEventListener('input', filterArticles);

        // Show/hide clear button as user types
        const clearBtn = document.getElementById('searchClearBtn');
        if (clearBtn) {
            searchInput.addEventListener('input', () => {
                const hasText = searchInput.value.length > 0;
                clearBtn.hidden = !hasText;
                searchInput.classList.toggle('has-clear', hasText);
            });
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearBtn.hidden = true;
                searchInput.classList.remove('has-clear');
                filterArticles();

                searchInput.focus();
            });
        }
    }

    // ⌘F / Ctrl+F and / are handled centrally in shortcuts.js

    // ── Split-screen workspace hooks ────────────────────────────────────
    // In the multi-pane layout (workspaceManager.js) graph/analytics are shown
    // next to the list instead of replacing it, so they need open/close paths
    // that leave the list and detail alone.
    const initReportView = () => {
        const reportContainer = document.getElementById('reportContainer');
        StorageManager.getArticlesIndex({ includeArchived: true }).then(articles => {
            import('./analyticsManager.js').then(mod => {
                mod.initAnalyticsReport(reportContainer, articles);
            });
        });
    };
    document.addEventListener('aish:ws-view', (e) => {
        const { view, open, scope } = e.detail || {};
        if (scope && scope !== 'history') return;

        const reportContainer = document.getElementById('reportContainer');

        if (view === 'report' && reportContainer) {
            const isOpen = reportContainer.style.display === 'block';
            if (open && !isOpen) { reportContainer.style.display = 'block'; initReportView(); }
            if (!open && isOpen) reportContainer.style.display = 'none';
        }
    });

    // Graph / Analytics buttons mirror what is open (same as the Feeds toolbar): pressed = that view is showing.
    const syncViewButtons = () => {
        const open = (id) => { const c = document.getElementById(id); return !!c && c.style.display === 'block'; };
        const r = open('reportContainer');
        [['reportToggleBtn', r], ['detailReportToggleBtn', r]].forEach(([id, on]) => {
            const b = document.getElementById(id);
            if (!b) return;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
    };
    const viewObserver = new MutationObserver(syncViewButtons);
    ['reportContainer'].forEach(id => { const c = document.getElementById(id); if (c) viewObserver.observe(c, { attributes: true, attributeFilter: ['style'] }); });
    syncViewButtons();

    // ── Shared report toggle ────────────────────────────────────────────
    const toggleReport = () => {
        const articleList = document.getElementById('articleList');
        const articleDetail = document.getElementById('articleDetail');

        const reportContainer = document.getElementById('reportContainer');
        if (!reportContainer) return;
        const isReport = reportContainer.style.display === 'block';
        if (isReport) {
            reportContainer.style.display = 'none';
            if (detailTopBar?.style.display === 'flex') {
                if (articleDetail) articleDetail.style.display = 'block';
            } else {
                if (articleList) articleList.style.display = 'block';
            }
        } else {
            if (articleList) articleList.style.display = 'none';
            if (articleDetail) articleDetail.style.display = 'none';

            reportContainer.style.display = 'block';
            initReportView();
        }
        syncViewButtons();
    };

    const reportToggleBtn = document.getElementById('reportToggleBtn');
    const detailReportToggleBtn = document.getElementById('detailReportToggleBtn');
    if (reportToggleBtn) reportToggleBtn.addEventListener('click', toggleReport);
    if (detailReportToggleBtn) detailReportToggleBtn.addEventListener('click', toggleReport);

}

export function loadHistory() {

    const reportContainer = document.getElementById('reportContainer');
    const articleList = document.getElementById('articleList');
    const articleDetail = document.getElementById('articleDetail');
    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');

    if (reportContainer && !wsActive()) reportContainer.style.display = 'none';
    if (articleDetail) articleDetail.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'none';
    if (historyTopBar) historyTopBar.classList.remove('scroll-hidden');
    if (detailTopBar) detailTopBar.classList.remove('scroll-hidden');
    if (historyTopBar) historyTopBar.style.display = 'flex';
    if (articleList) articleList.style.display = 'block';
    document.dispatchEvent(new Event('aish:ws-refresh'));
    showSkeleton(articleList);
    import('./feedManager.js')
        .then(m => m.reconcileStubs())
        .catch(() => {})
        .then(() => StorageManager.getArticlesIndex({ includeArchived: true }))
        .then(articles => {
            cachedArticles = articles.filter(a => !a.archived);
            archivedCache = articles.filter(a => a.archived);
            invalidateSearchIndex();
            renderTab();
        }).catch(() => clearSkeleton(articleList));
}

export function renderArticles(articles) {
    const articleList = document.getElementById('articleList');
    articleList.innerHTML = '';
    // The tabs live in the top bar (like Feeds' scope row), mounted once.
    const tabsBar = document.getElementById('historyTopBar');
    const tabsNav = buildTabs();
    if (tabsBar && tabsNav.parentNode !== tabsBar) tabsBar.appendChild(tabsNav);
    if (!articles || articles.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.id = 'emptyMessage';
        const p = document.createElement('p');
        if (historyTab === 'inbox' && cachedArticles.length === 0 && archivedCache.length === 0) p.textContent = T('🗂️ Your archive is as empty as a desert! Start saving some articles to fill it up. 🌵');
        else p.textContent = T('Nothing here yet');
        emptyMessage.appendChild(p);
        articleList.appendChild(emptyMessage);
        return;
    }

    // Cancel any in-flight chunked render so a rapid re-render (e.g. a
    // search keystroke) doesn't keep appending stale cards after we've
    // cleared the list.
    if (articleList.__renderChunkId) {
        cancelIdleCallback(articleList.__renderChunkId);
        articleList.__renderChunkId = null;
    }

    const sortedArticles = articles.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Render in small idle-time chunks instead of building every card in
    // one synchronous pass. On a large archive the old code blocked the
    // main thread for the whole render — the list sat empty (the
    // innerHTML='' above) until every card was built, which is the
    // "empty screen for a split second" flash. Chunking lets the browser
    // paint the first cards immediately and fill the rest in spare time.
    const CHUNK = 20;
    let index = 0;

    const renderChunk = () => {
        const end = Math.min(index + CHUNK, sortedArticles.length);
        for (; index < end; index++) {
            const article = sortedArticles[index];
            const listItem = buildArticleCard(article);
            articleList.appendChild(listItem);
        }
        if (index < sortedArticles.length) {
            articleList.__renderChunkId = scheduleIdle(renderChunk);
        } else {
            articleList.__renderChunkId = null;
        }
    };

    renderChunk();
}

/**
 * Build a single archive list item (li.article-card) for `article`.
 * Extracted from renderArticles() so the chunked renderer can build cards
 * one at a time without duplicating the markup.
 *
 * @param {object} article
 * @returns {HTMLLIElement}
 */
function buildArticleCard(article) {
    const articleHeader = article.title || (article.content && article.content.split('\n')[0]) || T('No title available');
    const listItem = document.createElement('li');
    listItem.classList.add('article-card');
    listItem.dataset.ts = String(article.timestamp);
    const formattedDate = new Date(article.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    let articleDomain = '';
    if (article.url) {
        articleDomain = new URL(article.url).hostname;
    }
    const modelBadge = article.modelId ? `<span class="card-model">${modelIcon(article)} ${escapeHtml(article.modelId)}</span>` : '';

    // Decision metadata (timeframe + reason)
    const decisionHtml = article.isDecision ? `
      <div class="card-decision">
        ${article.decisionTimeframe ? `<span class="decision-chip">🔖 ${escapeHtml(article.decisionTimeframe)}</span>` : ''}
        ${article.decisionReason ? `<span class="decision-reason">"${escapeHtml(article.decisionReason)}"</span>` : ''}
      </div>
    ` : '';

    listItem.innerHTML = `
        <div class="article-header">
          <div>
            <h4>${escapeHtml(articleHeader)}</h4>
            <p class="article-date">💾 ${formattedDate} ${article.url ? `${T('from')} <a href="${escAttr(article.url)}" target="_blank" rel="noopener">${escapeHtml(articleDomain)}</a> ↗` : ''}</p>
            ${modelBadge}
            ${decisionHtml}
          </div>
          <button class="star-button" title="${escAttr(T('Favorite'))}" aria-label="${escAttr(T('Favorite'))}" aria-pressed="${article.favorite ? 'true' : 'false'}">${icon('star', 'icon--lg')}</button>
        </div>
    `;
    listItem.classList.toggle('is-favorite', !!article.favorite);
    {   // ⋯ actions menu sits next to the star
        const star = listItem.querySelector('.star-button');
        const side = document.createElement('div'); side.className = 'card-side';
        star.replaceWith(side); side.appendChild(star);
        attachCardMenu(side, article);
    }

    // Favorited from a feed but never summarized: one-click summarize.
    if ((article.feedStub || article.savedOnly) && article.url) {
        const sumBtn = document.createElement('button');
        sumBtn.type = 'button';
        sumBtn.className = 'button-primary btn-sm';
        sumBtn.style.marginTop = '8px';
        setIconLabel(sumBtn, 'sparkles', T("✨ Analyze"));
        sumBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            sumBtn.disabled = true;
            setIconLabel(sumBtn, 'loader', T("⏳ Analyzing…"));
            chrome.runtime.sendMessage({ action: 'openFeedItem', url: article.url, summarize: true }, (res) => {
                if (chrome.runtime.lastError || !res || !res.success) {
                    sumBtn.disabled = false;
                    setIconLabel(sumBtn, 'sparkles', T("✨ Analyze"));
                    return;
                }
                // Re-check shortly; the summary replaces this placeholder when saved.
                let tries = 0;
                const poll = setInterval(async () => {
                    tries++;
                    try {
                        const idx = await StorageManager.getArticlesIndex();
                        const done = idx.some(a => !a.feedStub && !a.savedOnly && a.url === article.url);
                        if (done || tries > 40) {
                            clearInterval(poll);
                            if (done && document.getElementById('articleList')?.style.display !== 'none') loadHistory();
                            else { sumBtn.disabled = false; setIconLabel(sumBtn, 'sparkles', T("✨ Analyze")); }
                        }
                    } catch (_) { clearInterval(poll); }
                }, 3000);
            });
        });
        const hdr = listItem.querySelector('.article-header > div');
        if (hdr) hdr.appendChild(sumBtn);
    }

    listItem.querySelector('.star-button').addEventListener('click', async (event) => {
        event.stopPropagation();
        const next = await StorageManager.toggleFavorite(article.id);
        if (next === null) return;
        article.favorite = next;
        paintFavorite(article.id, next);
    });

    // Click on the card itself opens detail
    {   // reading status: badges (and Restore in the Archive tab)
        const host = listItem.querySelector('.article-header > div');
        const badges = statusBadges(article);
        if (host && badges.length) {
            // Status (New / Read / Sent / Archived) is the first chip in the same row as the tags.
            let row = host.querySelector('.card-tags');
            if (!row) {
                row = document.createElement('div');
                row.className = 'card-tags';
                const anchor = host.querySelector('.article-date');
                if (anchor) anchor.after(row); else host.appendChild(row);
            }
            const frag = document.createDocumentFragment();
            badges.forEach(([tone, text]) => { const b = document.createElement('span'); b.className = 'tag-chip status-badge ' + tone; b.textContent = text; frag.appendChild(b); });
            row.prepend(frag);
        }
        if (host && article.archived) {
            const restore = document.createElement('button');
            restore.type = 'button'; restore.className = 'button-secondary status-restore'; restore.textContent = T('↩ Restore to Inbox');
            restore.addEventListener('click', event => { event.stopPropagation(); applyStatus([article.id], { archived: false }); });
            host.appendChild(restore);
        }
    }
    registerCard(article, listItem);
    listItem.tabIndex = 0; listItem.setAttribute('role', 'button');   // reachable with Tab; Enter / Space opens it
    listItem.addEventListener('keydown', (event) => {
        if (event.target !== listItem || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        if (selectionActive()) { toggleCard(article); return; }
        showArticleDetail(article);
    });
    // Long-press a card → enter selection mode with it ticked (same as the Select button / ⋯ menu).
    let pressTimer = null, pressed = false, pressX = 0, pressY = 0;
    const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
    listItem.addEventListener('pointerdown', (event) => {
        if (event.button > 0 || event.target.closest('button') || event.target.closest('a')) return;
        pressed = false; pressX = event.clientX; pressY = event.clientY;
        if (selectionActive() || !canSelect(article)) return;
        cancelPress();
        pressTimer = setTimeout(() => { pressTimer = null; pressed = true; startSelectionWith(article); }, 500);
    });
    listItem.addEventListener('pointermove', (event) => {
        if (pressTimer && Math.hypot(event.clientX - pressX, event.clientY - pressY) > 10) cancelPress();
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => listItem.addEventListener(ev, cancelPress));
    listItem.addEventListener('contextmenu', (event) => { if (pressed) event.preventDefault(); });
    listItem.addEventListener('click', (event) => {
        if (pressed) { pressed = false; return; }   // the click that ends a long-press must not toggle it back off
        if (event.target.closest('button') || event.target.closest('a')) return;
        if (selectionActive()) { toggleCard(article); return; }
        showArticleDetail(article);
    });

    return listItem;
}

/**
 * Schedule `fn` to run during the browser's idle time, falling back to a
 * macrotask when requestIdleCallback isn't available. Returns a handle that
 * can be passed to cancelIdleCallback() (or clearTimeout() for the fallback).
 *
 * @param {() => void} fn
 * @returns {number}
 */
function scheduleIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
        return requestIdleCallback(fn, { timeout: 1000 });
    }
    return setTimeout(fn, 0);
}

/**
 * Cancel a handle returned by scheduleIdle().
 * @param {number} handle
 */
function cancelIdleCallback(handle) {
    if (typeof handle !== 'number') return;
    if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(handle);
    } else {
        clearTimeout(handle);
    }
}

// Split workspace: the analytics pane follows the search box too.
let reportSearchTimer = null;
function scheduleReportSearch(filterText, cheapMatch) {
    const reportContainer = document.getElementById('reportContainer');
    if (!wsActive() || !reportContainer || reportContainer.style.display !== 'block') return;
    clearTimeout(reportSearchTimer);
    reportSearchTimer = setTimeout(async () => {
        const all = await StorageManager.getArticlesIndex({ includeArchived: true });
        let list = all;
        if (filterText) {
            let ids = null;
            if (filterText.length >= 3) ids = new Set(tfidfSearch(ensureSearchIndex(), cachedArticles, filterText).map(a => String(a.timestamp)));
            list = all.filter(a => cheapMatch(a) || (ids && ids.has(String(a.timestamp))));
        }
        const mod = await import('./analyticsManager.js');
        mod.initAnalyticsReport(reportContainer, list);
    }, 250);
}

export function filterArticles() {
    const searchInput = document.getElementById('searchInput');
    const filterText = searchInput.value.trim();
    const lowerFilter = filterText.toLowerCase();

    // Tier 1: cheap title/tag substring match — this is the whole cost for
    // an empty or very short query, same as the original behaviour.
    const cheapMatch = (a) => {
        const titleMatch = (a.title || '').toLowerCase().includes(lowerFilter);
        return titleMatch;
    };

    scheduleReportSearch(filterText, cheapMatch);

    // Tier 2: once the query is long enough to be meaningful (2-char
    // queries match almost everything and aren't worth indexing), widen
    // the search to summary/content via the prebuilt TF-IDF index. This is
    // an index lookup, not a re-scan of every article's full text.
    let indexedMatchIds = null;
    if (filterText.length >= 3) {
        const index = ensureSearchIndex();
        const ranked = tfidfSearch(index, cachedArticles, filterText);
        indexedMatchIds = new Set(ranked.map(a => String(a.timestamp)));
    }

    const cards = document.querySelectorAll('.article-card');
    cards.forEach(card => {
        if (!filterText) { card.style.display = 'block'; return; }
        const headerText = card.querySelector('.article-header h4').textContent.toLowerCase();
        const cheapHit = headerText.includes(lowerFilter);
        const indexedHit = indexedMatchIds ? indexedMatchIds.has(card.dataset.ts) : false;
        card.style.display = (cheapHit || indexedHit) ? 'block' : 'none';
    });
}

/**
 * Fills in the #localInsights placeholder for the current article detail
 * view with readability badges and "similar in your archive"
 * links. Everything here runs on-device: readingLevel is pure
 * text math (textMetrics.js), and similarTo() reuses the same TF-IDF index
 * search already builds — no extra indexing pass, no network calls.
 */
async function renderLocalInsights(article, container) {
    if (!container) return;
    try {
        const index = ensureSearchIndex();
        const [metrics, related] = await Promise.all([
            computeMetrics(article),
            Promise.resolve(similarTo(index, cachedArticles, article, { limit: 4 }))
        ]);

        const badges = [];
        if (metrics.readingLevel) {
            badges.push(`<span class="tag-chip insight-chip" title="${escAttr(T('Flesch reading ease: {ease}/100', { ease: metrics.readingLevel.ease }))}">📖 ${T('{label} · grade {grade}', { label: metrics.readingLevel.label, grade: metrics.readingLevel.grade })}</span>`);
        }
        if (metrics.estimatedMinutes) {
            badges.push(`<span class="tag-chip insight-chip">⏱️ ${T('~{n} min read', { n: metrics.estimatedMinutes })}</span>`);
        }

        const relatedHtml = related.length ? `
          <div class="related-articles">
            <strong class="related-articles-title">${T('🔗 Similar in your archive')}</strong>
            ${related.map(r => `<div class="related-article-link" data-ts="${escAttr(r.article.timestamp)}">${escapeHtml(r.article.title || T('Untitled'))} <span class="related-article-score">(${T('{n}% similar', { n: Math.round(r.score * 100) })})</span></div>`).join('')}
          </div>` : '';

        container.innerHTML = `${badges.length ? `<div class="insight-chips">${badges.join('')}</div>` : ''}${relatedHtml}`;

        container.querySelectorAll('.related-article-link').forEach(el => {
            el.addEventListener('click', () => {
                const match = cachedArticles.find(a => String(a.timestamp) === el.dataset.ts);
                if (match) showArticleDetail(match);
            });
        });
    } catch (err) {
        // Silent by design — local insights are a bonus, never worth
        // interrupting the article detail view over.
        console.warn('[AISH] Local insights failed:', err);
        container.innerHTML = '';
    }
}

/**
 * Shows the full article detail view with back button
 */
/** Pinned follow-ups inline, the rest collapsed; pin changes and the export switch are saved right away. */
async function renderDetailQa(article, mount) {
    if (!mount) return;
    const turns = Array.isArray(article.conversation) ? article.conversation : [];
    const draw = async () => {
        mount.replaceChildren(qaSection(turns, {
            includeAll: await includeAllQuestions(),
            onPin: async () => {
                await StorageManager.saveConversation(article.id, turns);
                draw();
            },
            onIncludeAll: (v) => StorageManager.setLocal({ [SK.exportAllQuestions]: !!v }),
            onSource: (quote, chip) => { chip.classList.toggle('chat-src--open'); chip.textContent = chip.classList.contains('chat-src--open') ? '¶ ' + quote : '¶ ' + (quote.length > 38 ? quote.slice(0, 37) + '…' : quote); }
        }));
    };
    draw();
}

export async function showArticleDetail(article) {
    // List/graph/search cards only carry the lean articlesIndex shape (no
    // content) — load the full article:<id> record before rendering detail.
    // Callers that already pass a full in-memory article (e.g. mainScreen.js
    // right after a save) have `content` set and skip this fetch.
    if (article && article.id && article.content === undefined) {
        try {
            const full = await StorageManager.getArticleFull(article.id);
            article = { ...article, ...full };
        } catch (err) {
            console.error('[AISH] Failed to load article content:', err);
        }
    }

    if (article && article.id && article.conversation === undefined) {
        try {
            const conversation = await StorageManager.getConversation(article.id);
            article = { ...article, conversation };
            // follow-ups saved before they were appended to the summary: do it now (once)
            if (conversation.length && article.summaryBase === undefined && await StorageManager.saveConversation(article.id, conversation)) {
                article.summaryBase = article.summary;
            }
        } catch (_) { article = { ...article, conversation: [] }; }
    }
    currentDetailArticle = article;
    {   const ds = document.getElementById('detailStarBtn'); if (ds) { ds.hidden = !article.id || !!article.feedStub; paintDetailStar(!!article.favorite); } }
    recordArticleOpened(article);
    if (article && article.id && !article.readAt && !article.feedStub) { article.readAt = new Date().toISOString(); applyStatus([article.id], { read: true }).catch(() => {}); }
    const articleList = document.getElementById('articleList');
    const articleDetail = document.getElementById('articleDetail');
    const articleDetailContent = document.getElementById('articleDetailContent');

    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');

    if (!articleDetail || !articleDetailContent) return;

    // Choose the highest fidelity data field available instantly
    const rawContentSource = article.content || article.html || article.text || '';

    const safeTitle = escapeHtml(article.title || (rawContentSource && rawContentSource.split('\n')[0]) || T('Article'));
    // Saved summary and page HTML come from arbitrary pages (and restored backups): parse inert, then clean.
    const fallbackSummary = article.savedOnly
        ? '<p><em>' + escapeHtml(T("Saved without an AI main output. Open the page and tap ✨ Analyze to add one.")) + '</em></p>'
        : escapeHtml(T("No main output available"));
    const summaryDoc = new DOMParser().parseFromString(article.summaryBase !== undefined ? article.summaryBase : (typeof article.summary === 'string' ? article.summary : fallbackSummary), 'text/html');
    summaryDoc.querySelectorAll('img').forEach(el => el.remove());
    const safeSummary = cleanUntrustedHtml(summaryDoc.body).innerHTML;

    const detailDoc = new DOMParser().parseFromString(rawContentSource, 'text/html');
    cleanUntrustedHtml(detailDoc.body);
    // Keep the images; .detail-original img caps their width so they don't break the popup layout
    const safeContent = detailDoc.body.innerHTML || escapeHtml(T('No content available.'));
    const domain = article.url ? (() => { try { return new URL(article.url).hostname; } catch { return ''; } })() : '';
    const modelInfo = article.modelId ? `<span class="detail-model">${modelIcon(article)} ${escapeHtml(article.modelId)}</span>` : '';
    const lengthInfo = article.summaryLength ? `<span class="detail-length">📏 ${escapeHtml(article.summaryLength)}w</span>` : '';

    // Decision metadata
    const decisionBadge = article.isDecision ? `
      <div class="detail-decision">
        <div class="detail-decision-head">
          <span aria-hidden="true">🔖</span>
          <span class="detail-decision-title">${T('Saved for Later')}</span>
          ${article.decisionTimeframe ? `<span class="decision-chip">${escapeHtml(article.decisionTimeframe)}</span>` : ''}
        </div>
        ${article.decisionReason ? `<p class="detail-decision-reason">${escapeHtml(article.decisionReason)}</p>` : ''}
      </div>
    ` : '';

    articleDetailContent.innerHTML = `
      <div class="article-detail-card">
        <h3 class="detail-title"><img class="detail-fav" alt="" hidden>${safeTitle}</h3>
        <p class="detail-desc" hidden></p>
        <p class="detail-meta">
          ${article.url ? `<a href="${escAttr(article.url)}" target="_blank" rel="noopener">${escapeHtml(domain)} ↗</a> · ` : ''}
          ${new Date(article.timestamp).toLocaleDateString()}${(modelInfo || lengthInfo) ? ' · ' : ''}${modelInfo}${lengthInfo}
        </p>
        ${decisionBadge}
        <div class="action-bar detail-actions">
          <button class="button-secondary open-button">${icon('book-open')} ${lbl('Read 👓')}</button>
          <button class="button-secondary copy-button">${icon('copy')} ${lbl('Copy 📋')}</button>
          <button class="button-secondary md-button">${icon('download')} ${lbl('.MD 💾')}</button>
          <button class="button-secondary share-button">${icon('link')} ${lbl('Share 🔗')}</button>
          <button class="button-secondary kindle-button">${icon('book-open')} ${lbl('Kindle 📚')}</button>
          <button class="button-secondary localsend-button">${icon('smartphone')} ${lbl('LocalSend 📱')}</button>
        </div>
        <div class="summary-box">
          <strong class="summary-box-title">${T("🧙 Main output")}</strong>
          <div>${safeSummary}</div>
          <div id="qaMount" class="detail-qa"></div>
        </div>
        <div id="localInsights" class="detail-insights"></div>
        <details class="detail-original">
          <summary>${T('📄 Original Content')}</summary>
          <div class="detail-original-body">${safeContent}</div>
        </details>
      </div>
    `;

    const highlights = renderHighlights(article.highlights, key => t(key));
    if (highlights) articleDetailContent.querySelector('.summary-box').appendChild(highlights);

    // On-device insights (reading level and similar articles) load
    // asynchronously and progressively fill in — they never block the rest
    // of the detail view from rendering.
    renderLocalInsights(article, articleDetailContent.querySelector('#localInsights'));
    renderDetailQa(article, articleDetailContent.querySelector('#qaMount'));
    {   // saved page metadata: favicon + description (set as text, never as HTML)
        const m = article.meta || {};
        const fav = m.favicon || article.favicon;
        const img = articleDetailContent.querySelector('.detail-fav');
        if (img && fav && /^https?:|^data:/.test(fav)) { img.src = fav; img.hidden = false; img.addEventListener('error', () => { img.hidden = true; }); }
        const desc = articleDetailContent.querySelector('.detail-desc');
        const text = m.description || article.description || '';
        if (desc && text) { desc.textContent = text; desc.hidden = false; }
    }

    // Wire up buttons
    const shareBtn = articleDetailContent.querySelector('.share-button');
    const copyBtn = articleDetailContent.querySelector('.copy-button');
    const kindleBtn = articleDetailContent.querySelector('.kindle-button');
    const localSendBtn = articleDetailContent.querySelector('.localsend-button');
    const mdBtn = articleDetailContent.querySelector('.md-button');
    const openBtn = articleDetailContent.querySelector('.open-button');

    StorageManager.getAll().then((cfg) => {
        const pref = cfg.deliveryPreference === 'localsend' ? 'localsend' : 'kindle';
        if (kindleBtn) kindleBtn.style.display = pref === 'kindle' ? 'inline-flex' : 'none';
        if (localSendBtn) localSendBtn.style.display = pref === 'localsend' ? 'inline-flex' : 'none';
    }).catch(() => {
        // Fallback: show Kindle if settings retrieval fails.
        if (kindleBtn) kindleBtn.style.display = 'inline-flex';
        if (localSendBtn) localSendBtn.style.display = 'none';
    });

    if (shareBtn) shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareArticle(article); });
    if (copyBtn) copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyArticleToClipboard(article); });
    if (kindleBtn) kindleBtn.addEventListener('click', (e) => { e.stopPropagation(); sendToKindle(article); });
    if (localSendBtn) localSendBtn.addEventListener('click', (e) => { e.stopPropagation(); dispatchToLocalSend(article); });
    if (mdBtn) mdBtn.addEventListener('click', (e) => { e.stopPropagation(); exportToMarkdown(article); });
    if (openBtn) {
        openBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const readerArticle = await exportView(article);
            const newTab = window.open();
            newTab.document.write(`
                <html><head><title>${safeTitle}</title>
                <style>body{font-family:Georgia,serif;padding:20px;max-width:800px;margin:auto;background:#f4f4f4;color:#333;line-height:1.6;}
                h2{color:#444;}img{max-width:100%;height:auto;}</style></head>
                <body><h2>Summary</h2><div>${readerArticle.summary}</div><h2>Content</h2><div>${article.content}</div></body></html>
            `);
            newTab.document.close();
        });
    }
    // Show detail, hide list and graph
    if (articleList) articleList.style.display = 'none';

    if (historyTopBar) historyTopBar.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'flex';
    articleDetail.style.display = 'block';
    mountReadingTools({ scroller: document.getElementById('historyScreen'), content: articleDetailContent, article });   // Scroll to top + contents on long texts
    // Keyboard: focus moves to "Back" (so Esc / Enter returns); the card that opened this stays remembered.
    const back = document.getElementById('detailBackButton');
    if (back) back.focus({ preventScroll: true });
}

/** After "Back": focus the card that was open (or its neighbour when it is gone) and keep it in view. */
function restoreCardFocus(id) {
    const list = document.getElementById('articleList');
    if (!list) return;
    const card = (id && [...list.querySelectorAll('li[data-id]')].find(li => li.dataset.id === id)) || list.querySelector('li[tabindex="0"]');
    if (card) card.focus({ preventScroll: true });
    if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });
}
