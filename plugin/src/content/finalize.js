import { ttsLang, langBase } from '../modules/languages.js';
import { extractSummaryTitle, saveToLocalStorage } from './core.js';
import { readHighlightSelections } from './highlightSentences.js';
import { markdownToHtml, stripReasoning } from './markdown.js';
// content/finalize.js
// Everything that happens AFTER the model has finished writing: pull the metadata comments out of the raw text,
// build the HTML, language metadata, title. It needs no page DOM, so it runs in the content script (normal case)
// and in the background worker (when the tab navigated away while the model was still writing).

/** Incremental parser for the streamed API response: {summary, thinking} so far. */
export function createStreamParser(service) {
  let buffer = '', summary = '', thinking = '';
  const line1 = (line) => {
    line = line.trim();
    if (!line || line === 'data: [DONE]') return;
    try {
      const json = JSON.parse(line.startsWith('data: ') ? line.substring(6) : line);
      let piece = '';
      if (service === 'gemini') piece = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      else if (service === 'ollama') { piece = json.message?.content || json.response || ''; if (!piece && json.message?.thinking) thinking += json.message.thinking; }
      else piece = json.choices?.[0]?.delta?.content || json.message?.content || json.response || '';
      if (piece) summary += piece;
    } catch (_) { /* partial JSON */ }
  };
  return {
    push(chunk) { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(line1); },
    end() { if (buffer) { line1(buffer); buffer = ''; } },
    get summary() { return summary; },
    get thinking() { return thinking; }
  };
}

/** Language of the source text: detected on the device (no network), else the page's <html lang>; '' when unknown. */
export function detectContentLang(text, htmlLang) {
  const fallback = langBase(htmlLang || '');
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v || fallback); } };
    try {
      const api = (typeof browser !== 'undefined' && browser.i18n && browser.i18n.detectLanguage) ? browser : chrome;
      const handle = (r) => { const l = r && r.languages && r.languages[0]; done(l && (r.isReliable !== false || l.percentage >= 60) ? langBase(l.language) : ''); };
      const p = api.i18n.detectLanguage(String(text || '').slice(0, 1500), handle);
      if (p && p.then) p.then(handle).catch(() => done(''));
    } catch (_) { done(''); }
  });
}

/**
 * @param {object} o  raw, thinking, contentText, highlightSourceText (exact source sent to the model), highlightSourceTruncated,
 *   highlights (already recovered selections from chunked reading, when present),
 *   selectedLanguage, htmlLang,
 *   pageMeta (base metadata, may be {}), fixedTitle ('' = derive), attachedTitle (string when a PDF was attached, else null)
 * @returns {Promise<{error:string}|{cleanHtml,highlights,ghostQuotes,pageMeta,title}>}
 */
export async function finalizeSummary(o) {
  const summary = stripReasoning(o.raw || '');
  // Main output and highlights are independent results. Valid empty main output
  // must retain highlight rendering, storage, and exports.
  if (!summary.trim() && !Array.isArray(o.highlights)) return { error: 'The model returned no response. Try again or pick another model.' };

  const sumLang = langBase(ttsLang(o.selectedLanguage));
  const srcLang = await detectContentLang(o.contentText || '', o.htmlLang || '');
  const highlights = Array.isArray(o.highlights) ? o.highlights
    : readHighlightSelections(summary, o.highlightSourceText ?? o.contentText, srcLang || o.htmlLang, o.highlightSourceTruncated);
  const ghostQuotes = highlights.filter(selection => selection.status === 'resolved').map(selection => selection.text);
  const { paper: _paper, ...baseMeta } = o.pageMeta || {};
  const pageMeta = { ...baseMeta, ...(srcLang ? { contentLang: srcLang } : {}), summaryLang: sumLang };

  const cleanRawText = summary
    .replace(/<!--\s*GHOST_HIGHLIGHTS:\s*([\s\S]*?)\s*(?:-->|$)/gi, '')
    .replace(/<!--\s*TAGS:\s*[^>]+\s*-->/gi, '')
    .replace(/<!--\s*MOOD:[^>]*-->/gi, '')
    .replace(/<!--\s*SCHOLARLY:[\s\S]*?(?:-->|$)/gi, '')
    .replace(/<!--\s*QUESTIONS:[\s\S]*?(?:-->|$)/gi, '')
    .trim();
  const cleanHtml = markdownToHtml(cleanRawText);
  // document.title is often empty (PDFs especially): fall back to the summary's own <h2>.
  const title = o.attachedTitle !== null && o.attachedTitle !== undefined
    ? (extractSummaryTitle(cleanHtml) || o.attachedTitle || 'Untitled')
    : (o.fixedTitle || extractSummaryTitle(cleanHtml) || 'Untitled');
  return { cleanHtml, highlights, ghostQuotes, pageMeta, title };
}

/** Same as the in-page path: store the finished summary. `ctx` is what the page handed to the background when the run started. */
export function saveFinished(ctx, f, contentHtml) {
  const extra = { ...(ctx.feedUrl && ctx.feedUrl !== ctx.sourceUrl ? { feedUrl: ctx.feedUrl } : {}) };
  const analysisSource = typeof ctx.highlightSourceText === 'string' ? { text: ctx.highlightSourceText, truncated: !!ctx.highlightSourceTruncated } : undefined;
  return saveToLocalStorage(contentHtml, f.cleanHtml, ctx.sourceUrl, f.title, '', [], ctx.modelIdentifier, ctx.summaryLength, undefined, extra, f.pageMeta, f.highlights, analysisSource);
}

/** Background: a run whose page went away is finished here. */
export async function finishDetached(ctx, raw, thinking) {
  const f = await finalizeSummary({
    raw, thinking, contentText: ctx.contentText, pageTitle: ctx.pageTitle, selectedLanguage: ctx.selectedLanguage,
    highlightSourceText: ctx.highlightSourceText, highlightSourceTruncated: ctx.highlightSourceTruncated,
    highlights: ctx.highlights,
    htmlLang: ctx.htmlLang, pageMeta: ctx.pageMeta, fixedTitle: ctx.fixedTitle, attachedTitle: ctx.attachedTitle
  });
  if (f.error) return { error: f.error };
  f.highlights = f.highlights.map(selection => selection.status === 'resolved' ? { ...selection, status: 'unavailable' } : selection);
  const article = await saveFinished(ctx, f, ctx.contentHtml || '');
  return { ...f, article };
}
