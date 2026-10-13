import { SK } from './modules/storageKeys.js';
import { lengthSpec, readLengthSetting, resolveSummaryLength } from './modules/summaryLength.js';
import { loadPageTextLimit, limitPageText } from './modules/pageInput.js';
import { loadPagePrompts, buildPagePrompt, buildPageInstructions, buildReadingPartPrompt } from './modules/pagePrompts.js';
import { matchPagePaper } from './content/paper.js';
import { finalizeSummary } from './content/finalize.js';
import { startSavedPageRestore } from './content/savedPage.js';
import { resolveHighlightSelections, mergeHighlightSelections } from './content/highlightSentences.js';
// content.js — Orchestrator
// Entry point for the content script. Imports from ./content/* modules and
// wires them together. The build system (scripts/build.js) bundles this into
// a single self-contained file for each platform (MV3 content scripts can't
// use ES modules directly).

import {
  getAllTextContent,
  estimateTokens,
  ollamaNumCtx,
  needsChunking,
  splitForContext,
  modelContextFromShow,
  inlineAndCompressImages
} from './content/extractor.js';

import { markdownToHtml, stripReasoning, escapeHtml } from './content/markdown.js';

import {
  ensureHighlightUiStyles,
  showDecisionDialog,
  createStreamingOverlay,
  updateStreamingOverlay,
  waitForSpeedReadingComplete,
  toggleHybridSidebar,
  ensureHybridSidebar,
  sidebarMessage,
  showPlaceholder,
  insertSummary,
  selectTargetElement,
  updateDebugPanel
} from './content/ui.js';

import {
  setHighlightingEnabled,
  isAnyHighlightingEnabled,
  scheduleRestoreAnnotations,
  clearHighlightElements,
  clearHighlightElementsByType,
  startAnnotationWatchers,
  handleTextSelection,
  highlightFromSelectionOrText,
  handleHighlightClick,
  applyGhostHighlights,
  handleGhostHighlightClick,
  getUserHighlightTexts,
  revealQuote,
  setPageChatHandler
} from './content/highlighter.js';

import {
  saveToLocalStorage,
  collectPageMeta
} from './content/core.js';

import {
  isPdfPage,
  extractPdfText,
  pdfErrorMessage
} from './content/pdfExtractor.js';

(() => {
  // ── Cross-browser shim ────────────────────────────────────────────────
  if (typeof chrome === 'undefined' && typeof browser !== 'undefined') {
    globalThis.chrome = browser;
  }

  // Smart injection guard: If the extension context is alive AND this page
  // already has our content script initialized, skip re-initialization.
  try {
    if (window.aishContentScriptInitialized && chrome.runtime.id) {
      return;
    }
  } catch (e) {
    // Context orphaned (extension reloaded) — re-initialize below.
  }

  window.aishContentScriptInitialized = true;

  const API_BASE = 'https://api.byphil.eu';
  // const API_BASE = 'http://localhost:3000'; // for local testing

  // Define the donation messages
  const donationMessages = [
    "Help me brew new ideas with a soothing cup of tea! 🍵",
    "Help me upgrade my workspace with a new plant! 🌿",
    "Help me fund a tiny house to code in peace! 🏡",
    "Get me closer to my goal of relocating into a sailboat! 🚤",
    "Feeling generous? A pizza would definitely boost my brainstorming sessions! 🍕",
    "Help me turn my remote work into a van life adventure! 🚐",
    "Your support can help me build my tiny home! 🏠",
    "Help me get a kayak to paddle through my creative process! 🛶",
    "Get me a smoothie to recharge my problem-solving skills! 🥤"
  ];

  function getRandomDonationMessage() {
    const randomIndex = Math.floor(Math.random() * donationMessages.length);
    return donationMessages[randomIndex];
  }

  /**
   * Turn a server-side daily-limit error into a friendly, upgrade-oriented
   * message. The byphil API enforces a free-tier daily summary cap (cloud
   * mode); when it's hit it returns a non-OK status. We detect that here and
   * show copy that nudges toward Pro / coming back tomorrow, instead of a
   * raw "HTTP 429: ..." string.
   *
   * @param {string} error - the raw error string from the stream
   * @returns {string} a user-facing message
   */
  function friendlyLimitError(error) {
    const e = String(error || '');
    // The byphil API returns a 402 with "Free trial exhausted (N requests
    // per day)" when the free-tier daily cap is hit. Match on the trial /
    // exhausted / per-day phrasing (plus the status code) rather than
    // requiring a specific word, so it stays robust to minor copy tweaks.
    const isLimit =
      /402|429|trial exhausted|requests per day|requests per week|limit|quota|too many|rate/i.test(e);
    if (!isLimit) return `Error: ${e}`;
    return 'You\u2019ve reached your free daily summary limit. Come back tomorrow for 3 more \u2014 or upgrade to Pro for unlimited summaries.';
  }

  // Cache the setting so sync reads don't block event handlers
  let userHighlightingEnabled = true;
  let aiHighlightingEnabled = true;
  let pendingFeedUrl = '';

  chrome.storage.sync.get(['highlightingEnabled', 'userHighlightingEnabled', 'aiHighlightingEnabled'], (data) => {
    const legacy = data.highlightingEnabled !== false;
    userHighlightingEnabled = data.userHighlightingEnabled !== undefined ? data.userHighlightingEnabled !== false : legacy;
    aiHighlightingEnabled = data.aiHighlightingEnabled !== undefined ? data.aiHighlightingEnabled !== false : legacy;
    setHighlightingEnabled(userHighlightingEnabled, aiHighlightingEnabled);

    if (!isAnyHighlightingEnabled()) {
      clearHighlightElements();
    } else {
      scheduleRestoreAnnotations(80);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;

    let shouldRestore = false;

    if ('userHighlightingEnabled' in changes) {
      userHighlightingEnabled = changes.userHighlightingEnabled.newValue !== false;
      setHighlightingEnabled(userHighlightingEnabled, aiHighlightingEnabled);
      if (!userHighlightingEnabled) {
        clearHighlightElementsByType('user');
      } else {
        shouldRestore = true;
      }
    }

    if ('aiHighlightingEnabled' in changes) {
      aiHighlightingEnabled = changes.aiHighlightingEnabled.newValue !== false;
      setHighlightingEnabled(userHighlightingEnabled, aiHighlightingEnabled);
      if (!aiHighlightingEnabled) {
        clearHighlightElementsByType('ghost');
      } else {
        shouldRestore = true;
      }
    }

    if ('highlightingEnabled' in changes && !('userHighlightingEnabled' in changes) && !('aiHighlightingEnabled' in changes)) {
      const legacyEnabled = changes.highlightingEnabled.newValue !== false;
      userHighlightingEnabled = legacyEnabled;
      aiHighlightingEnabled = legacyEnabled;
      setHighlightingEnabled(userHighlightingEnabled, aiHighlightingEnabled);
      if (!legacyEnabled) {
        clearHighlightElements();
      } else {
        shouldRestore = true;
      }
    }

    if (shouldRestore && isAnyHighlightingEnabled()) {
      scheduleRestoreAnnotations(80);
    }
  });

  // Restore persisted highlights as soon as the DOM is ready
  document.addEventListener('mouseup', handleTextSelection);
  document.addEventListener('click', handleHighlightClick);
  document.addEventListener('click', handleGhostHighlightClick);

  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    scheduleRestoreAnnotations(80);
  } else {
    document.addEventListener('DOMContentLoaded', () => scheduleRestoreAnnotations(80));
  }

  ensureHighlightUiStyles();
  startAnnotationWatchers();

  // ── Extension Message Handlers ───────────────────────────────────────────────

  // Registry for in-flight streaming fetches. Background pushes chunks via
  // chrome.tabs.sendMessage({action:'streamChunk', requestId, payload}),
  // which we route to the matching handler here. This replaced an earlier
  // runtime.connect()-based approach that was unreliable on Safari — see
  // the note in background.js.
  const streamHandlers = new Map();
  // Request whose summary this page still has to finish; if the page goes away first, the background takes over.
  let runIdForUnload = '';
  window.addEventListener('pagehide', (e) => {
    if (runIdForUnload && streamHandlers.has(runIdForUnload)) {
      try { chrome.runtime.sendMessage({ action: 'runDetached', requestId: runIdForUnload }).catch(() => {}); } catch (_) { /* gone */ }
    }
  });

  // The summary that is running right now (context + latest progress), so a panel that opens
  // after it started — e.g. when it was started from the on-page tool — can show it.
  let liveRun = null;
  const savedPage = startSavedPageRestore(() => !!liveRun, state => {
    const message = { action: 'pageHighlightState', ...state };
    try { chrome.runtime.sendMessage(message)?.catch?.(() => {}); } catch (_) { /* sidebar closed */ }
    const sidebar = document.getElementById('ai-summary-hybrid-sidebar');
    const wrapped = sidebarMessage(message);
    if (sidebar?.contentWindow && wrapped) sidebar.contentWindow.postMessage(wrapped, '*');
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Normalize casing so both 'PING' and 'ping' work.
    const action = (request.action || '').toLowerCase();
    if (action === 'ping') {
      sendResponse({ status: 'pong', caps: ['attachment'] });
      return true;
    }

    if (request.action === 'getSummaryState') {
      sendResponse({ running: !!liveRun, context: liveRun && liveRun.context, progress: liveRun && liveRun.progress });
      return false;
    }
    if (request.action === 'getPageHighlightState') {
      sendResponse(savedPage.getHighlightState());
      return false;
    }

    if (request.action === 'streamChunk' && request.requestId) {
      const handler = streamHandlers.get(request.requestId);
      if (handler) handler(request.payload);
      sendResponse({ status: 'ok' });
      return true;
    }

    if (request.action === 'contextMenuHighlight') {
      const text = request.text?.trim();
      if (text && userHighlightingEnabled) {
        highlightFromSelectionOrText(text);
      }
      sendResponse({ status: 'ok' });
      return true;
    }

    if (request.action === 'contextMenuClearHighlights') {
      clearHighlightElements();

      // Clear only for the current URL using the new array structure
      chrome.storage.local.get([SK.annotations], (res) => {
        let annotations = res[SK.annotations];
        if (Array.isArray(annotations)) {
          const currentUrl = window.location.href.split('#')[0];
          annotations = annotations.filter(a => a.url !== currentUrl);
          chrome.storage.local.set({ [SK.annotations]: annotations }, () => {
            sendResponse({ status: 'ok' });
          });
        } else {
          sendResponse({ status: 'ok' });
        }
      });
      return true;
    }

    if (request.action === 'toggleHybridSidebar') {
      toggleHybridSidebar();
      sendResponse({ status: 'Sidebar toggled' });
      return true;
    }

    if (request.action === 'fetchSummaryAndClose') {
      sendResponse({ success: true });

      showDecisionDialog((decision) => {
        const streamOverlay = createStreamingOverlay();
        document.body.appendChild(streamOverlay);

        const decisionDialog = document.getElementById('aish-decision-overlay');
        if (decisionDialog) decisionDialog.remove();

        chrome.storage.sync.get(['debugEnabled'], async (data) => {
          const promptToUse = undefined;
          if (!document.body) {
            updateStreamingOverlay(streamOverlay, '❌ Cannot summarize this page type.', true);
            return;
          }
          const hiddenTarget = document.createElement('div');
          hiddenTarget.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
          document.body.appendChild(hiddenTarget);
          try {
            const result = await fetchSummary('', 'en-US', promptToUse, 200, hiddenTarget, data.debugEnabled || false, 'extension');
            const article = result.article;

            if (article) {
              article.decisionTimeframe = decision.timeframe;
              article.decisionReason = decision.reason;
              article.decisionSavedAt = decision.savedAt;
              article.isDecision = true;

              // article.id identifies its entry in 'articlesIndex' (see
              // saveToLocalStorage in content/core.js) — patch the decision
              // fields onto that index entry rather than the old flat array.
              chrome.storage.local.get({ [SK.articlesIndex]: [] }, (data) => {
                const articlesIndex = data[SK.articlesIndex] || [];
                const idx = articlesIndex.findIndex(a => a.id === article.id);
                if (idx >= 0) {
                  articlesIndex[idx] = {
                    ...articlesIndex[idx],
                    decisionTimeframe: article.decisionTimeframe,
                    decisionReason: article.decisionReason,
                    decisionSavedAt: article.decisionSavedAt,
                    isDecision: true
                  };
                  chrome.storage.local.set({ [SK.articlesIndex]: articlesIndex }, () => {
                    chrome.runtime.sendMessage({ action: 'scheduleDecisionAlarm', article });
                    waitForSpeedReadingComplete(streamOverlay, () => {
                      chrome.runtime.sendMessage({ action: 'closeTabSelf' });
                    });
                  });
                }
              });
            } else {
              updateStreamingOverlay(streamOverlay, 'No response received', true);
            }
          } catch (e) {
            updateStreamingOverlay(streamOverlay, `❌ Analysis failed: ${e.message || 'Unknown error'}`, true);
          }
        });
      });
      return false;
    }

    // "Save only": keep the page in History without calling the AI.
    if (request.action === 'savePage') {
      (async () => {
        try {
          let html = '', text = '';
          if (isPdfPage()) { const ex = await extractPdfText(); html = ex.html; text = ex.text; }
          else { const sc = getAllTextContent(); html = sc.html; text = sc.text; }
          if (!String(text || '').trim()) { sendResponse({ success: false, error: 'empty' }); return; }
          let meta = {};
          try { meta = collectPageMeta(); } catch (_) { /* optional */ }
          try { html = await inlineAndCompressImages(html); } catch (_) { /* keep original html */ }
          const title = (meta.title || document.title || window.location.hostname || 'Untitled').toString().slice(0, 200);
          const feedUrl = request.feedUrl && request.feedUrl !== window.location.href ? { feedUrl: request.feedUrl } : {};
          const saved = await saveToLocalStorage(html, '', window.location.href, title, '', [], '', 0, undefined,
            { savedOnly: true, ...feedUrl }, meta);
          sendResponse({ success: true, id: saved && saved.id, title });
        } catch (err) {
          sendResponse({ success: false, error: String(err && err.message || err) });
        }
      })();
      return true;
    }

    if (request.action === 'revealQuote') {
      sendResponse({ success: revealQuote(String(request.quote || '')) });
      return false;
    }

    if (request.action === 'stopSummary') {
      if (activeSummaryRequestId) chrome.runtime.sendMessage({ action: 'stopFetch', requestId: activeSummaryRequestId }).catch(() => {});
      sendResponse({ success: true });
      return false;
    }

    if (request.action === 'fetchSummary') {
      const { additionalQuestions: popupQuestions, selectedLanguage, prompt: popupPrompt, summaryMode, summaryLength: msgSummaryLength, attachment, highlightPrompt } = request;
      // Original feed link when started from the Feed (page URL may differ after redirects).
      pendingFeedUrl = request.feedUrl || '';
      sendResponse({ success: true, message: summaryMode === 'extension' ? 'Analyzing page...' : 'Selection started' });

      (async () => {
        if (summaryMode === 'extension') {
          chrome.storage.sync.get(['debugEnabled'], (data) => {
            const promptToUse = popupPrompt;
            const length = msgSummaryLength || 'stored';   // shortcut / context menu send no length: use the saved setting
            if (!document.body) {
              sendResponse({ success: false, error: 'Cannot summarize this page type.' });
              return;
            }
            const hiddenTarget = document.createElement('div');
            hiddenTarget.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
            document.body.appendChild(hiddenTarget);
            fetchSummary(
              popupQuestions,
              selectedLanguage,
              promptToUse,
              length,
              hiddenTarget,
              data.debugEnabled || false,
              summaryMode,
              attachment,
              highlightPrompt
            );
          });
          return;
        }

        const targetElement = await selectTargetElement();
        if (targetElement) {
          chrome.storage.sync.get(['debugEnabled'], (data) => {
            const promptToUse = popupPrompt;
            const length = msgSummaryLength || 'stored';   // shortcut / context menu send no length: use the saved setting
            fetchSummary(
              popupQuestions,
              selectedLanguage,
              promptToUse,
              length,
              targetElement,
              data.debugEnabled || false,
              summaryMode,
              null,
              highlightPrompt
            );
          });
        }
      })();
      return false;
    }
  });

  /** One non-streaming request through the background worker; resolves with the raw response body. */
  function callOnce(apiUrl, headers, body) {
    return new Promise((resolve, reject) => {
      const rid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let buf = '';
      streamHandlers.set(rid, (msg) => {
        if (msg.stopped) { streamHandlers.delete(rid); reject(Object.assign(new Error('cancelled'), { cancelled: true })); return; }
        if (msg.error) { streamHandlers.delete(rid); reject(new Error(msg.error)); return; }
        if (msg.chunk) buf += msg.chunk;
        if (msg.done) { streamHandlers.delete(rid); resolve(buf); }
      });
      activeSummaryRequestId = rid;   // so the popup's Stop button reaches this request
      chrome.runtime.sendMessage({ action: 'startFetch', requestId: rid, apiUrl, headers, body: JSON.stringify(body) }, (ack) => {
        if (chrome.runtime.lastError || (ack && ack.started === false)) { streamHandlers.delete(rid); reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || (ack && ack.error) || 'Failed to start')); }
      });
    });
  }

  /**
   * The page does not fit the model's context window: read it in parts, ask for compact notes on each part
   * preserving material for final synthesis and retaining selected sentence prefixes for the final page analysis.
   */
  async function condenseForOllama({ apiUrl, headers, model, text, sourceTruncated, windowTokens, overheadTokens, outputWords, pagePrompts, tick }) {
    const instructions = buildPageInstructions(pagePrompts);
    const partTokens = Math.max(1200, windowTokens - 1500 - 700 - estimateTokens(instructions));
    const parts = splitForContext(text, partTokens);
    if (parts.length < 2) return { text, parts: 1 };
    const budgetTokens = Math.max(600, windowTokens - overheadTokens - Math.ceil(outputWords * 2.2) - 600);
    const perPartWords = Math.max(60, Math.min(400, Math.floor(budgetTokens / parts.length / 1.6)));
    const notes = [], highlights = [];
    const noteChars = Math.max(0, Math.floor(budgetTokens * 3 / parts.length) - 40);
    for (let i = 0; i < parts.length; i++) {
      tick(i, parts.length);
      const partPrompt = buildReadingPartPrompt({ highlightPrompt: pagePrompts.highlightPrompt, part: i + 1, parts: parts.length, words: perPartWords });
      const body = {
        model, stream: false,
        options: { num_ctx: Math.min(windowTokens, ollamaNumCtx(estimateTokens(partPrompt + parts[i]), perPartWords)) },
        messages: [
          { role: 'system', content: partPrompt },
          { role: 'user', content: parts[i] }
        ]
      };
      const raw = await callOnce(apiUrl, headers, body);
      let note = '';
      try { note = JSON.parse(raw).message?.content || ''; } catch (_) { note = raw; }
      note = stripReasoning(note).trim();
      try {
        const result = JSON.parse(note.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        highlights.push(...resolveHighlightSelections(result.highlights, text, undefined, sourceTruncated, parts[i]));
        note = typeof result.notes === 'string' ? result.notes : '';
      } catch (_) { highlights.push({ text: '', status: 'invalid-response' }); }
      // Selection recovery is independent of the final model's context budget.
      // Only discovery notes enter the final request; never let their total grow unbounded.
      if (noteChars) notes.push(`[Part ${i + 1} of ${parts.length}]\n${note.slice(0, noteChars)}`);
    }
    return { text: notes.join('\n\n'), parts: parts.length, highlights: mergeHighlightSelections(highlights) };
  }

  async function openChatFromPage() {
    if (!document.body) return;
    const articleId = savedPage.getArticle()?.id || '';
    let opened = false;
    try { const r = await chrome.runtime.sendMessage({ action: 'openNativeSidePanel', articleId }); opened = !!(r && r.success); } catch (_) { /* native sidebar unavailable */ }
    if (!opened) {
      const sidebar = ensureHybridSidebar(articleId);
      const message = sidebarMessage({ action: 'openSavedChat', articleId });
      if (message) sidebar?.contentWindow?.postMessage(message, '*');
    }
  }
  setPageChatHandler(openChatFromPage);

  // ── Summary fetch + streaming ───────────────────────────────────────────────

  // requestId of the summary currently streaming (Stop button → stopSummary).
  let activeSummaryRequestId = null;

  async function fetchSummary(additionalQuestions, selectedLanguage, prompt, summaryLength, targetElement, debugEnabled, summaryMode = 'extension', attachment = null, highlightPrompt = undefined) {
    const [pagePrompts, pageTextLimit] = await Promise.all([
      loadPagePrompts({ summaryPrompt: prompt, highlightPrompt }),
      loadPageTextLimit()
    ]);
    // A PDF the user attached in the popup: its text was already extracted there, so the page itself is not read at all.
    const attached = attachment && typeof attachment.text === 'string' && attachment.text ? attachment : null;
    const pdfMode = !!attached || isPdfPage();
    // Typical case: the (paywalled) DOI page is open, the PDF is attached → metadata from the page, text from the PDF.
    const pageMatch = attached ? (() => { try { return matchPagePaper(attached.text); } catch (_) { return null; } })() : null;
    const sourceUrl = attached && !pageMatch ? 'pdf://attached/' + encodeURIComponent(String(attached.name || 'document.pdf').slice(0, 120)) : window.location.href;

    // ── relay: defined first so every path (incl. PDF extraction errors) can report back ──
    const relay = (action, payload = {}) => {
      if (summaryMode !== 'extension') return;
      const msg = { action, ...payload };
      if (action === 'summaryContext') liveRun = { context: msg, progress: null };
      else if (action === 'summaryProgress' && liveRun) liveRun.progress = msg;
      else if (action === 'summaryComplete' || action === 'summaryCancelled' || action === 'summaryError') liveRun = null;

      // Broadcast to all extension pages (native popup, native side
      // panel). On Firefox this does NOT reach a popup embedded in a
      // hybrid-sidebar <iframe>, but it's the reliable path for every
      // other context.
      chrome.runtime.sendMessage(msg).catch(() => {});

      // ALSO push directly into the hybrid-sidebar iframe we created.
      // Firefox downgrades an extension page embedded in a regular web
      // page to content-script privileges, so runtime.sendMessage
      // broadcasts never arrive there. A plain postMessage between the
      // content script and the iframe's own document needs no extension
      // privileges, so this is the reliable return path in pop-out mode.
      const sidebar = document.getElementById('ai-summary-hybrid-sidebar');
      const wrapped = sidebarMessage(msg);
      if (sidebar && sidebar.contentWindow && wrapped) {
        try { sidebar.contentWindow.postMessage(wrapped, '*'); } catch (_) { /* sidebar frame may already be gone */ }
      }
    };


    // PDF pages have no DOM article to scrape — extract the document's own
    // text via pdf.js. The return shape ({ html, text }) matches
    // getAllTextContent(), so everything downstream keeps working unchanged.
    // For regular HTML pages isPdfPage() is false and this branch never runs.
    let contentHtml, contentText;
    if (attached) {
      contentHtml = String(attached.html || '');
      contentText = attached.text;
      if (pageMatch) {
        const pp = pageMatch.paper;
        const head = ['Metadata from the publisher page (the full text follows):', pageMatch.title && 'Title: ' + pageMatch.title, pp.authors && 'Authors: ' + pp.authors, pp.journal && 'Journal: ' + pp.journal, pp.year && 'Year: ' + pp.year, pp.doi && 'DOI: ' + pp.doi].filter(Boolean).join('\n');
        contentText = head + '\n\n' + contentText;
      }
    } else if (isPdfPage()) {
      try {
        const extracted = await extractPdfText();
        contentHtml = extracted.html;
        contentText = extracted.text;
      } catch (err) {
        // A real PDF page but extraction failed (e.g. a local file:// PDF
        // whose read was denied). Fail loudly and helpfully rather than send
        // an empty/scrubbed prompt upstream or leaving the UI stuck.
        showPlaceholder(targetElement, 'Could not read this PDF.');
        relay('summaryError', { error: pdfErrorMessage(err) });
        throw err;
      }
    } else {
      const scraped = getAllTextContent();
      contentHtml = scraped.html;
      contentText = scraped.text;
    }
    const truncatedContent = limitPageText(contentText, pageTextLimit);
    // "Auto" (or a custom number from the popup) becomes a word count now that the article length is known.
    if (summaryLength === 'stored') {
      summaryLength = lengthSpec(readLengthSetting(await chrome.storage.local.get([SK.summaryLength, SK.summaryLengthMode, SK.summaryLengthBias]), SK));
    }
    const lengthWasAuto = typeof summaryLength === 'string' && summaryLength.startsWith('auto');
    summaryLength = resolveSummaryLength(summaryLength, (contentText.match(/\S+/g) || []).length);

    // Tell the popup what this summary is built from (shown as "What I used"). Only things that are
    // really sent to the model: page text, the user's highlights, the focus question, the feed source.
    let ctxMsg = null;
    {
      const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
      relay('summaryContext', ctxMsg = {
        words: (truncatedContent.match(/\S+/g) || []).length,
        shortened: truncatedContent.length < contentText.length,
        host: attached && !pageMatch ? 'PDF' : hostOf(window.location.href),
        highlights: pdfMode ? 0 : getUserHighlightTexts().length,
        focus: !!(additionalQuestions || '').trim(),
        source: pendingFeedUrl ? hostOf(pendingFeedUrl) : '',
        language: selectedLanguage || '',
        length: Number(summaryLength) || 200,
        lengthAuto: lengthWasAuto
      });
    }

    // Start image compression immediately and let it run while AI is streaming.
    const imageCompressionPromise = inlineAndCompressImages(contentHtml);

    const donationMessage = getRandomDonationMessage();
    showPlaceholder(targetElement, donationMessage);

    return new Promise((resolve, reject) => {
      // Sensitive keys (servicesConfig, licenseKey) now live in LOCAL storage;
      // harmless prefs stay in sync.
      Promise.all([
        chrome.storage.sync.get(['activeService', 'connectionMode', 'preferredCloudModel']),
        chrome.storage.local.get([SK.servicesConfig, SK.licenseKey])
      ]).then(async ([syncData, localData]) => {
        const data = { ...syncData, ...localData };
        const localAuth = await chrome.storage.local.get([SK.token]).catch(() => ({}));
        const sessionToken = localAuth?.[SK.token] || '';
        const connectionMode = data.connectionMode || 'cloud';
        let activeService = data.activeService || 'openai';
        let cfg = (data[SK.servicesConfig] || {})[activeService] || {};
        let apiKey = cfg.apiKey || '';

        let apiUrl = cfg.endpoint;
        // Resolve the active model. It may be a legacy string or a
        // provider-bound object ({ id, provider }). Normalize to the id.
        const resolveModelId = (m) => {
          if (!m) return '';
          return typeof m === 'string' ? m : (m.id || '');
        };
        let modelIdentifier = resolveModelId(cfg.activeModelId)
          || (Array.isArray(cfg.customModel) ? resolveModelId(cfg.customModel[0]) : resolveModelId(cfg.customModel))
          || cfg.model;

        if (connectionMode === 'cloud') {
          activeService = 'cloud';
          apiUrl = `${API_BASE}/v1/projects/ai_summary_helper/chat`;
          modelIdentifier = data.preferredCloudModel || 'google/gemini-3.8-flash';
          apiKey = sessionToken || data[SK.licenseKey] || '';
        } else if (cfg) {
          apiUrl = cfg.endpointUrl || apiUrl;
          modelIdentifier = cfg.modelIdentifier || modelIdentifier;
        }

        let apiKeyOptional = false;
        if (connectionMode !== 'cloud') {
          try {
            const servicesUrl = chrome.runtime.getURL('services.json');
            const servicesResp = await fetch(servicesUrl);
            if (servicesResp && servicesResp.ok) {
              const servicesList = await servicesResp.json();
              const svcMeta = servicesList.find(s => (s.id || '').toLowerCase() === (activeService || '').toLowerCase());
              apiKeyOptional = svcMeta?.apiKeyOptional || false;
            }
          } catch (e) { /* services metadata is optional; defaults apply */ }
        } else {
          apiKeyOptional = true;
        }

        if (activeService === 'ollama') apiKeyOptional = true;

        if (!apiKey && !apiKeyOptional) {
          alert('Please set your API key in the extension popup.');
          relay('summaryError', { error: 'API key not set' });
          reject(new Error('API key not set'));
          return;
        }

        try {
          if (!modelIdentifier && connectionMode !== 'cloud') {
            try {
              const servicesUrl = chrome.runtime.getURL('services.json');
              const servicesResp = await fetch(servicesUrl);
              if (servicesResp && servicesResp.ok) {
                const servicesList = await servicesResp.json();
                const svcMeta = servicesList.find(s => (s.id || '').toLowerCase() === (activeService || '').toLowerCase());
                modelIdentifier = svcMeta?.defaultModel || '';
              }
            } catch (e) { /* services metadata is optional; defaults apply */ }
          }
          if (!modelIdentifier && connectionMode !== 'cloud' && String(activeService || '').toLowerCase() === 'ollama') {
            throw new Error('No Ollama model selected. Install one (e.g. "ollama pull llama3.2") and pick it in the model panel.');
          }

          if (!apiUrl) throw new Error('Model endpoint is not configured.');
          try { new URL(apiUrl); } catch (urlErr) { throw new Error(`Configured endpoint is not a valid URL: ${apiUrl}`); }

          const headers = { 'Content-Type': 'application/json' };
          let requestBody;
          let promptTokensEst = 0;
          let finalApiUrl = apiUrl;

          let selectedHighlights;
          let systemPrompt = buildPagePrompt({ ...pagePrompts, selectedLanguage, summaryLength, additionalQuestions });
          // Repeat the same contract after the source for models that drift on long pages.
          let finalReminder = '=== FINAL INSTRUCTIONS ===\n' + systemPrompt;

          // ── Route based on API format ──
          if (activeService === 'gemini') {
            finalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelIdentifier)}:streamGenerateContent?alt=sse`;
            headers['x-goog-api-key'] = apiKey;
            const parts = [
              { text: systemPrompt },
              { text: `SOURCE PAGE:\n${truncatedContent}` }
            ];
            parts.push({ text: finalReminder });
            requestBody = JSON.stringify({ contents: [{ role: 'user', parts }] });
          } else {
            // Default OpenAI / Cloud / Custom format
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            const { [SK.installId]: installId } = await chrome.storage.local.get(SK.installId);
            if (installId) headers['X-Install-ID'] = installId;

            // Local model whose context window cannot hold the page: read it in parts instead of letting Ollama cut it.
            let pageText = truncatedContent;
            if (activeService === 'ollama' && /\/api\/chat\b/.test(finalApiUrl)) {
              try {
                const overhead = estimateTokens(systemPrompt + finalReminder);
                const total = overhead + estimateTokens(truncatedContent);
                if (total > 3500) {
                  let win = 0;
                  try {
                    const showRaw = await callOnce(finalApiUrl.replace(/\/api\/chat\b.*$/, '/api/show'), headers, { model: modelIdentifier });
                    win = modelContextFromShow(JSON.parse(showRaw));
                  } catch (e) { if (e && e.cancelled) throw e; }
                  const ctxWindow = Math.min(win || 32768, 32768);
                  if (needsChunking(total, ctxWindow, summaryLength)) {
                    const r = await condenseForOllama({
                      apiUrl: finalApiUrl, headers, model: modelIdentifier, text: truncatedContent, sourceTruncated: truncatedContent.length < contentText.length, windowTokens: ctxWindow, overheadTokens: overhead, outputWords: Number(summaryLength) || 200, pagePrompts,
                      tick: (i, n) => relay('summaryProgress', { chunk: `Reading part ${i + 1} of ${n}…`, progress: 20 + Math.round((i / n) * 8) })
                    });
                    if (r.parts > 1) {
                      pageText = r.text;
                      selectedHighlights = r.highlights;
                      systemPrompt = buildPagePrompt({ ...pagePrompts, selectedLanguage, summaryLength, additionalQuestions, sourceIsNotes: true });
                      finalReminder = '=== FINAL INSTRUCTIONS ===\n' + systemPrompt;
                      if (ctxMsg) relay('summaryContext', ctxMsg = { ...ctxMsg, parts: r.parts, window: ctxWindow });
                    }
                  }
                }
              } catch (e) {
                if (e && e.cancelled) { relay('summaryCancelled'); try { targetElement.remove(); } catch (_) { /* card may already be removed */ } resolve({ success: false, cancelled: true }); return; }
                console.warn('[AISH] chunked reading failed, sending the page in one piece:', e);
              }
            }
            const userMessage = `SOURCE PAGE:\n${pageText}\n\n${finalReminder}`;
            const body = {
              model: modelIdentifier,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
              ],
              stream: true
            };
            // Ollama silently cuts the prompt to its default 4096-token window (keeping only the first few tokens and the tail).
            // Ask for a window that fits this page, and tell the popup what we sent so it can warn when it still does not fit.
            if (activeService === 'ollama' && /\/api\/chat\b/.test(finalApiUrl)) {
              promptTokensEst = estimateTokens(systemPrompt + userMessage);
              body.options = { num_ctx: ollamaNumCtx(promptTokensEst, summaryLength) };
              if (ctxMsg) relay('summaryContext', ctxMsg = { ...ctxMsg, pageTokens: promptTokensEst, numCtx: body.options.num_ctx });
            }
            requestBody = JSON.stringify(body);
          }

          if (debugEnabled) {
            updateDebugPanel(`Requesting ${modelIdentifier}...\n\nURL: ${finalApiUrl}\n\nPayload: ${requestBody}`, finalApiUrl);
          }

          let summary = "";
          let thinkingText = "";   // reasoning tokens (Ollama "thinking"): never shown, only a fallback if no answer arrives
          const streamContainer = targetElement.querySelector('.placeholder');
          const outputArea = document.createElement('div');
          outputArea.style.marginTop = '15px';
          outputArea.style.borderTop = '1px solid #ccc';
          outputArea.style.paddingTop = '10px';
          streamContainer.appendChild(outputArea);

          relay('summaryProgress', { chunk: 'Connected to API, waiting for response…', progress: 20 });

          const streamStart = Date.now();
          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          activeSummaryRequestId = requestId;
          let buffer = '';
          let firstTokenReceived = false;
          let lastProgressRelayTime = 0;

          // The model "thinking" before its first token often eats the
          // biggest chunk of the wait, and previously the progress bar sat
          // hidden the whole time (nothing to show a percentage for) — so it
          // only ever appeared right as the response was nearly done. Ramp a
          // small fake percentage while waiting so the bar shows up
          // immediately and stays visibly alive; real word-based progress
          // below takes over the moment the first token arrives.
          let waitingRampInterval = null;
          if (summaryMode === 'extension') {
            waitingRampInterval = setInterval(() => {
              if (firstTokenReceived) { clearInterval(waitingRampInterval); waitingRampInterval = null; return; }
              const elapsed = Date.now() - streamStart;
              const waitingPct = Math.min(28, 20 + Math.floor(elapsed / 500));
              relay('summaryProgress', { chunk: 'Waiting for the model to start responding…', progress: waitingPct });
            }, 500);
          }

          // Message-based streaming (not runtime.connect/ports) — see the
          // comment on streamHandlers above for why. We still send the
          // initial request via a plain sendMessage (which reliably wakes a
          // suspended Safari background page), then background pushes
          // chunks back to this tab individually.
          //
          // IMPORTANT: register the handler BEFORE sending anything to
          // background. If we send first and register after awaiting the
          // ack, there's a race: background can start pushing
          // 'request-started'/'response'/chunk messages the instant it
          // receives startFetch — often before our sendMessage ack
          // round-trip even completes — and any message that arrives before
          // streamHandlers.set() runs is silently dropped (streamHandlers.get()
          // returns undefined, so it's a no-op). On a fast API response this
          // can mean the 'done' message itself is lost, which is exactly why
          // this got stuck forever on "Connected to API, waiting for
          // response…" — nothing was left to resolve it.
          streamHandlers.set(requestId, async (msg) => {
            if (msg.stopped) {
              // The user pressed Stop in the popup: nothing is saved.
              if (waitingRampInterval) { clearInterval(waitingRampInterval); waitingRampInterval = null; }
              streamHandlers.delete(requestId);
              activeSummaryRequestId = null;
              try { targetElement.remove(); } catch (_) { /* card may already be removed */ }
              relay('summaryCancelled');
              resolve({ success: false, cancelled: true });
              return;
            }
            if (msg.error) {
              if (waitingRampInterval) { clearInterval(waitingRampInterval); waitingRampInterval = null; }
              console.error('❌ Error:', msg.error);
              // A server-enforced daily limit (free tier, cloud mode) comes
              // back as a non-OK status from the byphil API. Surface it as a
              // friendly, upgrade-oriented message instead of a raw HTTP error
              // — the whole point of the limit is to nudge toward Pro.
              const friendly = friendlyLimitError(msg.error);
              relay('summaryError', { error: friendly });
              targetElement.querySelector('.placeholder').innerHTML = `<b>${escapeHtml(friendly)}</b>`;
              reject(new Error(msg.error));
              streamHandlers.delete(requestId);
              return;
            }

            if (msg.done) {
              if (waitingRampInterval) { clearInterval(waitingRampInterval); waitingRampInterval = null; }
              streamContainer.remove();
              let pageMeta = {};
              if (!attached || pageMatch) { try { pageMeta = collectPageMeta(); } catch (_) { /* metadata is optional */ } }   // an attached PDF has nothing to do with the open tab
              const fin = await finalizeSummary({
                raw: summary, thinking: thinkingText, contentText, pageTitle: attached && !pageMatch ? String(attached.name || '') : document.title,
                highlightSourceText: truncatedContent, highlightSourceTruncated: truncatedContent.length < contentText.length,
                highlights: selectedHighlights,
                selectedLanguage, htmlLang: (!attached || pageMatch) ? document.documentElement.lang : '', pageMeta,
                fixedTitle: (pageMatch && pageMatch.title) || document.title || '',
                attachedTitle: attached && !pageMatch ? String(attached.name || '').replace(/\.pdf$/i, '') : null
              });
              if (fin.error) {
                relay('summaryError', { error: fin.error });
                const ph = targetElement.querySelector('.placeholder'); if (ph) ph.textContent = fin.error;
                reject(new Error(fin.error));
                streamHandlers.delete(requestId);
                return;
              }
              const { cleanHtml, ghostQuotes, title: articleTitle } = fin;
              pageMeta = fin.pageMeta;

              // Apply ghost highlights to the page now that it's safe to do so.
              // Skip on PDF pages: Chrome's built-in PDF viewer is a locked-down
              // internal component with no injectable DOM, so there's nothing to
              // highlight. Recovered sentences remain readable in the summary window.
              const pageMatches = pdfMode
                ? ghostQuotes.map(text => ({ text, status: 'unavailable' }))
                : applyGhostHighlights(ghostQuotes);
              const highlightResults = fin.highlights.map(selection => selection.status === 'resolved'
                ? { ...selection, status: pageMatches.find(match => match.text === selection.text)?.status || 'unavailable' }
                : selection);

              // WAIT FOR IMAGE COMPRESSION TO FINISH BEFORE SAVING
              let finalContentHtml = contentHtml;
              try {
                finalContentHtml = await imageCompressionPromise;
              } catch (compressionError) {
                console.warn('[Arguments] Background image compression failed. Falling back to original HTML.', compressionError);
              }

              if (summaryMode === 'inline') {
                const summaryContainer = document.createElement('blockquote');
                summaryContainer.setAttribute('data-aish-ui', '1');
                summaryContainer.style.cssText = "border-left: 4px solid #007bff; padding: 15px; margin: 20px 0; background: rgba(0,123,255,0.05);";
                summaryContainer.innerHTML = `<div><h2 style="margin-top:0">Main output 🧙</h2>${cleanHtml}</div>`;
                insertSummary(targetElement, summaryContainer);
              } else {
                targetElement.remove();
                relay('summaryComplete', {
                  summary: cleanHtml,
                  title: articleTitle,
                  url: sourceUrl,
                  timestamp: new Date().toISOString(),
                  modelId: modelIdentifier,
                  meta: pageMeta,
                  content: finalContentHtml,
                  highlights: highlightResults
                });
              }

              saveToLocalStorage(finalContentHtml, cleanHtml, sourceUrl, articleTitle, '', [], modelIdentifier, summaryLength, undefined, { ...(pendingFeedUrl && pendingFeedUrl !== sourceUrl ? { feedUrl: pendingFeedUrl } : {}) }, pageMeta, highlightResults, { text: truncatedContent, truncated: truncatedContent.length < contentText.length })
                .then(savedArticle => {
                  savedPage.remember(savedArticle);
                  try { chrome.runtime.sendMessage({ action: 'runSaved', requestId }).catch(() => {}); } catch (_) { /* optional */ }
                  if (savedArticle && savedArticle.id) relay('summarySaved', { id: savedArticle.id, url: sourceUrl });
                  resolve({ success: true, article: savedArticle });
                })
                .catch(err => {
                  console.error('Failed to save article:', err);
                  resolve({ success: true, article: null });
                });

              streamHandlers.delete(requestId);
              return;
            }

            if (msg.chunk) {
              if (!firstTokenReceived) {
                // Raw stream data has started arriving even before it's
                // been parsed into actual summary text — stop the waiting
                // ramp here and jump straight to 30% instead of leaving it
                // capped at 18% until the first real word shows up.
                firstTokenReceived = true;
                if (waitingRampInterval) { clearInterval(waitingRampInterval); waitingRampInterval = null; }
                relay('summaryProgress', { chunk: 'Receiving data…', progress: 30 });
              } else {
                relay('summaryProgress', { chunk: 'Receiving data…' });
              }
              buffer += msg.chunk;
              const lines = buffer.split('\n');
              buffer = lines.pop();

              for (let line of lines) {
                line = line.trim();
                if (!line || line === 'data: [DONE]') continue;

                try {
                  let contentPiece = '';
                  const cleanLine = line.startsWith('data: ') ? line.substring(6) : line;
                  const json = JSON.parse(cleanLine);

                  if (activeService === 'ollama' && json.done && typeof json.prompt_eval_count === 'number' && ctxMsg && promptTokensEst > 3000 && json.prompt_eval_count > 300) {
                    relay('summaryContext', ctxMsg = { ...ctxMsg, seenTokens: json.prompt_eval_count });   // the popup shows how much was read (or the "cut off" notice)
                  }
                  if (activeService === 'gemini') {
                    contentPiece = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  } else if (activeService === 'ollama') {
                    // Ollama: content may be in message.content OR message.thinking
                    contentPiece = json.message?.content || json.response || '';
                    if (!contentPiece && json.message?.thinking) thinkingText += json.message.thinking;
                  } else {
                    contentPiece = json.choices?.[0]?.delta?.content || json.message?.content || json.response || '';
                  }

                  if (contentPiece) {
                    // firstTokenReceived is already set + the waiting ramp
                    // already cleared as soon as the raw msg.chunk arrived
                    // above, ahead of parsing it into actual summary text.
                    summary += contentPiece;

                    outputArea.innerHTML = `<small style="opacity:0.7; color: #666;">Drafting summary...</small><br>${markdownToHtml(summary)}`;
                    if (debugEnabled) updateDebugPanel(summary, finalApiUrl);

                    const streamingOverlay = document.getElementById('aish-streaming-overlay');
                    if (streamingOverlay) {
                      updateStreamingOverlay(streamingOverlay, summary, false);
                    }

                    const wordCount = summary.split(/\s+/).filter(Boolean).length;
                    const now = Date.now();
                    // Throttled by elapsed time rather than word count — a
                    // fixed "every 10 words" gate stayed silent for a long
                    // stretch when a provider streamed in large multi-word
                    // chunks, which is what made the bar look frozen/late.
                    // A time gate keeps updates flowing smoothly regardless
                    // of how the provider chunks its output.
                    if (summaryMode === 'extension' && now - lastProgressRelayTime > 200) {
                      lastProgressRelayTime = now;
                      const elapsed = Math.floor((now - streamStart) / 1000);

                      // Estimate output progress from received words vs. the
                      // target summary length. Clamp to [0, 99] until done,
                      // and never let it drop below the waiting-phase ramp.
                      const targetWords = Number(summaryLength) || 200;
                      const estimatedPct = Math.min(99, Math.max(30, Math.round((wordCount / targetWords) * 100)));

                      relay('summaryProgress', {
                        chunk: `${wordCount} words · ${elapsed}s · ${estimatedPct}%`,
                        preview: summary,
                        progress: estimatedPct
                      });
                    }
                  }
                } catch (e) { /* Ignore partial JSON chunks */ }
              }
            }
          });

          // Safari wake-up ping: iOS/macOS aggressively suspends the
          // background worker. The first message-pass through can take
          // 100-300ms to spin the worker up, so fire a no-op wakeup first
          // to warm it before the actual startFetch handshake. The stream
          // handler above is already registered by this point, so even if
          // background responds unexpectedly fast, nothing gets dropped.
          try {
            await new Promise((res) => {
              chrome.runtime.sendMessage({ action: 'wakeup' }, () => {
                void chrome.runtime.lastError;   // read it so Chrome does not log it: this only wakes the worker
                res();
              });
            });
          } catch (_) { /* best-effort notification to the background */ }

          try {
            await new Promise((res, rej) => {
              // If this page is closed or navigated away while the model is still writing, the background finishes the run
              // from this snapshot (it does the same parsing and saving as the done-handler below).
              let detach = null;
              try {
                let baseMeta = {};
                if (!attached || pageMatch) { try { baseMeta = collectPageMeta(); } catch (_) { /* optional */ } }
                detach = {
                  sourceUrl, summaryMode, service: activeService, modelIdentifier, summaryLength, selectedLanguage,
                  contentText: String(contentText || '').slice(0, 30000), contentHtml: contentHtml || '',
                  highlightSourceText: truncatedContent, highlightSourceTruncated: truncatedContent.length < contentText.length,
                  highlights: selectedHighlights,
                  pageTitle: attached && !pageMatch ? String(attached.name || '') : document.title,
                  htmlLang: (!attached || pageMatch) ? document.documentElement.lang : '',
                  pageMeta: baseMeta,
                  fixedTitle: (pageMatch && pageMatch.title) || document.title || '',
                  attachedTitle: attached && !pageMatch ? String(attached.name || '').replace(/\.pdf$/i, '') : null,
                  feedUrl: pendingFeedUrl || ''
                };
              } catch (_) { detach = null; }
              runIdForUnload = requestId;
              chrome.runtime.sendMessage({
                action: 'startFetch',
                requestId,
                apiUrl: finalApiUrl,
                headers: headers,
                body: requestBody,
                detach
              }, (ack) => {
                if (chrome.runtime.lastError) {
                  rej(new Error(chrome.runtime.lastError.message));
                } else if (ack && ack.started === false) {
                  rej(new Error(ack.error || 'Failed to start stream'));
                } else {
                  res();
                }
              });
            });
          } catch (connectErr) {
            console.error('❌ Failed to start streaming fetch:', connectErr);
            streamHandlers.delete(requestId);
            relay('summaryError', { error: 'Could not connect to the background service. Please try again.' });
            targetElement.querySelector('.placeholder').innerHTML = '<b>Error:</b> Could not connect to the background service. Please try again.';
            reject(new Error(connectErr.message || 'Connection failed'));
            return;
          }

        } catch (error) {
          console.error('❌ Error:', error);
          relay('summaryError', { error: error.message });
          targetElement.querySelector('.placeholder').innerHTML = `<b>Error:</b> ${escapeHtml(error.message)}`;
          reject(error);
        }
      });
    });
  }
})();
