/**
 * feedAi.js — AI day recaps for feed items.
 *
 * Only runs on an explicit click. Sends titles, source names and short
 * snippets (never full articles) to the user's configured AI connection via
 * the background worker's `aiComplete` action.
 */

import { languageEnglishName, languageRule } from './languages.js';
import { T } from './feedI18n.js';

import { resolveFeedStyle, styleSuffix } from './promptBuilder.js';
export const MAX_RECAP_ITEMS = 40;   // maximum batch size
let recapLimit = Infinity;            // items per recap request (user setting); 0 / Infinity = no limit
export const getRecapLimit = () => recapLimit;
export function setRecapLimit(n) { n = Math.round(Number(n)); recapLimit = n === 0 || n === Infinity ? Infinity : n >= 10 ? n : Infinity; }
const SNIPPET_MAX = 160;

let aiSeq = 0;
let aiTransport = null;
export function setAiTransport(transport) { aiTransport = typeof transport === 'function' ? transport : null; }
/** `signal` (AbortSignal) cancels the request in the background worker too — there is no timeout, slow local models may take minutes. */
export function aiComplete(system, user, onStage, signal, onProgress, { partial = false, service = '' } = {}) {
    if (aiTransport) return aiTransport({ system, user, signal, partial, service, onStage, onProgress });
    return new Promise((resolve, reject) => {
        const id = `ai${Date.now()}_${++aiSeq}`;
        let settled = false;
        const cancelled = () => Object.assign(new Error(T('Cancelled')), { name: 'AbortError', cancelled: true });
        if (signal && signal.aborted) return reject(cancelled());
        if (signal) signal.addEventListener('abort', () => {
            if (settled) return;
            settled = true; done();
            try { chrome.runtime.sendMessage({ action: 'aiCancel', id }, () => void chrome.runtime.lastError); } catch (e) { /* worker gone */ }
            reject(cancelled());
        }, { once: true });
        const onMsg = (m) => { if (m && m.action === 'aiProgress' && m.id === id) { if (onStage) onStage(m.phase === 'stream' ? 'write' : 'wait'); if (onProgress) onProgress(m); } };
        const done = () => { try { chrome.runtime.onMessage.removeListener(onMsg); } catch (e) { /* no listener API */ } };
        try { chrome.runtime.onMessage.addListener(onMsg); } catch (e) { /* tests */ }
        if (onStage) { onStage('send'); setTimeout(() => onStage('wait'), 350); }
        chrome.runtime.sendMessage({ action: 'aiComplete', system, user, id, partial, ...(service ? { service } : {}) }, (res) => {
            if (settled) { void chrome.runtime.lastError; return; }
            settled = true; done();
            if (onStage) onStage('parse');
            if (chrome.runtime.lastError) {
                const m = chrome.runtime.lastError.message || '';
                return reject(new Error(/port closed|Receiving end/i.test(m)
                    ? T('Background script is outdated — reload the extension at chrome://extensions')
                    : m));
            }
            if (!res || !res.ok) return reject(new Error((res && res.error) || T('AI request failed')));
            resolve(res.text || '');
        });
    });
}

async function langRule() {
    try { const { selectedLanguage } = await chrome.storage.sync.get('selectedLanguage'); const r = languageRule(selectedLanguage); return r ? ' ' + r : ''; }
    catch (e) { return ''; }
}

async function languageName() {
    try {
        const { selectedLanguage } = await chrome.storage.sync.get('selectedLanguage');
        return languageEnglishName(selectedLanguage || 'en-US');
    } catch (e) { return 'en-US'; }
}

/** The user's saved style preferences for 'briefing' or 'recap' as a system-prompt suffix ('' when none). */
async function feedStyle(scope) {
    try {
        const { feedPromptCfg } = await chrome.storage.sync.get('feedPromptCfg');
        return styleSuffix(resolveFeedStyle(feedPromptCfg, scope));
    } catch (e) { return ''; }
}

function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Fingerprint of what the AI actually sees of an item (title + snippet) — changes when a news article is edited. */
export function itemSig(i) {
    const t = `${clip(i.title, 140)}|${clip(i.snippet, SNIPPET_MAX)}`;
    let h = 0x811c9dc5;
    for (let k = 0; k < t.length; k++) { h ^= t.charCodeAt(k); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
}

export function itemsForPrompt(list, subTitleFn, mark, snippetMax = SNIPPET_MAX) {
    return list.map((i, k) => {
        const parts = [`[${k + 1}] ${clip(subTitleFn(i), 40)} — ${clip(i.title, 140)}${mark ? mark(i) : ''}`];
        const sn = clip(i.snippet, snippetMax);
        if (sn) parts.push(sn);
        return parts.join(' — ');
    }).join('\n');
}

export function parseRecap(text) {
    // Some models wrap the whole answer in a ```markdown fence: drop the fence lines, keep what is inside.
    // Headings glued into one line ("… themes: ### Economy ### Politics --- …") are broken up again, and horizontal rules ("---") dropped.
    const lines = String(text || '').split('\n')
        .flatMap(l => l.split(/\s+(?=#{2,6}\s+\S)|\s+-{3,}\s+/))
        .map(l => l.replace(/\s+-{3,}\s*$/, '').trim())
        .filter(l => l && !/^```[\w-]*$/.test(l) && !/^([-*_])\1{2,}$/.test(l));
    const overview = [];
    const themes = [];
    // A model that answers with headings ("### Economy") has written a structured briefing: keep it whole so the
    // bullets stay under their heading instead of being pulled out into one flat, capped theme list.
    const structured = lines.some(l => /^#{1,6}\s+\S/.test(l));
    for (const l of lines) {
        // Discard obsolete metadata emitted by older models without reviving retired features.
        if (/^(?:LABELS|SCORES|MOOD)\s*:/i.test(l)) continue;
        if (!structured && /^[-•*]\s+/.test(l)) themes.push(l.replace(/^[-•*]\s+/, ''));
        else overview.push(l);
    }
    // Lines stay separate (the view renders markdown); the old single-line form is what a plain-text model gave anyway.
    return { overview: overview.join(structured ? '\n' : ' '), themes: themes.slice(0, 5) };
}

/** Create a recap without mood or category metadata. */
export async function generateRecap(list, subTitleFn, { styleText, onStage, signal, onProgress, service } = {}) {
    const lang = await languageName();
    const suffix = styleText !== undefined ? styleSuffix(styleText) : await feedStyle('briefing');
    const lr = await langRule();
    const system = 'You write brief news-digest recaps from headlines and snippets. '
        + `Reply in the language ${lang}. Use ONLY the given items; do not invent facts. Format exactly:\n`
        + 'First, 2-3 sentences of overview.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the source.\n'
        + 'No headings, no markdown other than the "- " lines.' + suffix + lr;
    const chunk = list.slice(0, recapLimit);
    const text = await aiComplete(system, `Items:\n${itemsForPrompt(chunk, subTitleFn)}`, onStage, signal,
        onProgress, { service });
    const r = parseRecap(text);
    if (!r.overview && !r.themes.length) throw new Error(T('The AI returned an empty recap'));
    return r;
}

/**
 * Refresh an existing recap with ONLY the items that are new or were edited since it was written
 * (the previous recap text stands in for everything already covered, so no old headline is sent again).
 */
export async function generateRecapUpdate(prev, fresh, subTitleFn, { edited = () => false, onStage, signal, onProgress, service } = {}) {
    const lang = await languageName();
    const suffix = await feedStyle('briefing');
    const lr = await langRule();
    const system = 'You maintain a brief news-digest recap. You get the CURRENT recap and a numbered list of NEW or EDITED items (edited ones are marked). '
        + `Update the recap so it covers the earlier points and the new items. Reply in the language ${lang}. Use ONLY the given text; do not invent facts. `
        + 'Keep still-relevant points, add new standout stories naming the source, and drop or correct anything an edited item contradicts. Format exactly:\n'
        + 'First, 2-3 sentences of overview.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the source.\n'
        + 'No headings, no markdown other than the "- " lines.' + suffix + lr;
    const chunk = fresh.slice(0, recapLimit);
    const cur = [prev.overview, ...(prev.themes || []).map(t => '- ' + t)].filter(Boolean).join('\n');
    const text = await aiComplete(system, `Current recap:\n${cur}\n\nNew or edited items:\n${itemsForPrompt(chunk, subTitleFn, i => edited(i) ? ' (edited)' : '')}`, onStage, signal,
        onProgress, { service });
    const r = parseRecap(text);
    if (!r.overview && !r.themes.length) throw new Error(T('The AI returned an empty recap'));
    return { ...r, sent: chunk };
}

const INTRO_STYLES = {
    short: 'exactly one sentence (at most 25 words)',
    briefing: '2 to 3 sentences in a neutral, informative briefing tone',
    personal: '2 to 3 sentences in a friendly, personal tone, like a note to myself (you may address the reader as "you")',
};

/**
 * Short introduction for a reading digest, written ONLY from the already-written summaries
 * (title + start of each) — no article text is sent. style: 'short' | 'briefing' | 'personal'.
 */
export async function generateDigestIntro(list, style = 'briefing', { onStage, signal, onProgress } = {}) {
    const lang = await languageName();
    const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    const system = `You write the short introduction at the top of a reading digest made of several article summaries. Write it in ${lang}. `
        + `Length and tone: ${INTRO_STYLES[style] || INTRO_STYLES.briefing}. `
        + 'Mention what the pieces have in common or how they differ. Use ONLY information from the summaries: no new facts, no quotes, no markdown, no lists, no title, no greeting. Reply with the intro text only.';
    const user = list.slice(0, 12).map((a, i) => `[${i + 1}] ${clip(a.title, 140)} — ${clip(plain(a.summary), 400)}`).join('\n');
    const raw = await aiComplete(system, user, onStage, signal, onProgress, { partial: true });
    const text = String(raw || '').replace(/[*#_`>]/g, '').replace(/^["“”'\s]+|["“”'\s]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 700);
    if (!text) throw new Error(T('The AI reply could not be read'));
    return text;
}

/** Stable fingerprint of a recap (what a week/month recap was built from) — changes when a day/week recap is regenerated. */
export function recapSig(r) {
    const t = [r.overview, (r.themes || []).join('|')].join('¦');
    let h = 0x811c9dc5;
    for (let k = 0; k < t.length; k++) { h ^= t.charCodeAt(k); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
}

function partText(p) {
    const r = p.recap;
    return [`[${p.label}] ${clip(r.overview, 400)}`,
        ...(r.themes || []).slice(0, 5).map(t => '- ' + clip(t, 160))].join('\n');
}

/**
 * Week / month recap built ONLY from already-written recaps (day recaps, or week recaps for a month) — no article is sent again.
 * With `prev`, only the new or changed parts are sent and the previous roll-up stands in for everything else.
 * parts = [{ label, recap }]
 */
export async function generateRollup(parts, { label = '', prev = null, edited = () => false, onStage, signal, onProgress } = {}) {
    const lang = await languageName();
    const suffix = await feedStyle('recap');
    const lr = await langRule();
    const system = 'You merge brief news-digest recaps of several days or weeks into ONE recap for the whole period. '
        + (prev ? 'You get the CURRENT period recap plus only the NEW or CHANGED recaps (changed ones are marked); keep still-relevant points and correct anything a changed recap contradicts. ' : '')
        + `Reply in the language ${lang}. Use ONLY the given recaps; do not invent facts. Format exactly:\n`
        + 'First, 2-3 sentences of overview of the whole period.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the day or week and the source.\n'
        + 'No headings, no markdown other than the "- " lines.' + suffix + lr;
    const body = parts.map(p => partText(p) + (edited(p) ? ' (changed)' : '')).join('\n\n');
    const cur = prev ? [prev.overview, ...(prev.themes || []).map(t => '- ' + t)].filter(Boolean).join('\n') : '';
    const text = await aiComplete(system, `Period: ${label}\n\n${prev ? `Current period recap:\n${cur}\n\nNew or changed recaps:\n` : 'Recaps:\n'}${body}`, onStage, signal, onProgress);
    const r = parseRecap(text, 0);
    if (!r.overview && !r.themes.length) throw new Error(T('The AI returned an empty recap'));
    return r;
}
