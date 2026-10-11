// promptBuilder.js — style preferences for feed briefings and recaps.
// Pure functions: no DOM, no storage. The wording is English on purpose: it is sent to the AI,
// which answers in the language chosen in the popup.

export const TONES = ['neutral', 'casual', 'formal'];
export const LENGTHS = ['short', 'medium', 'long'];

const TONE_TEXT = {
    neutral: 'Tone: neutral and factual.',
    casual: 'Tone: casual and friendly.',
    formal: 'Tone: formal and precise.'
};

function pick(list, ids) {
    const set = new Set(ids || []);
    return list.filter(f => set.has(f.id)).map(f => f.text);
}

export function normalizeBuilder(b, defaults = FEED_DEFAULTS) {
    const o = { ...defaults, ...(b || {}) };
    if (!TONES.includes(o.tone)) o.tone = defaults.tone;
    if (!LENGTHS.includes(o.length)) o.length = defaults.length;
    o.focus = Array.isArray(o.focus) ? o.focus.filter(x => typeof x === 'string') : [...defaults.focus];
    o.extra = String(o.extra || '').slice(0, 800);
    return o;
}

// ── Feeds & briefings ───────────────────────────────────────────────────────
// The recap/briefing output format is machine-parsed, so these only steer style and wording.
const FEED_LENGTH = {
    short: 'Keep the overview to one or two sentences.',
    medium: 'Keep the overview to two or three sentences.',
    long: 'Make the overview a little more detailed (four or five sentences).'
};

export const FEED_FOCUS = [
    { id: 'facts',   text: 'Stick to hard facts and name the sources.' },
    { id: 'numbers', text: 'Include concrete numbers where the items give them.' },
    { id: 'impact',  text: 'Briefly say why each standout story matters.' },
    { id: 'humor',   text: 'A touch of light humor is welcome, never at the expense of accuracy.' }
];
export const FEED_DEFAULTS = { tone: 'neutral', length: 'medium', focus: [], extra: '' };

export function buildFeedStyle(b) {
    const o = normalizeBuilder(b, FEED_DEFAULTS);
    const parts = [TONE_TEXT[o.tone], FEED_LENGTH[o.length], ...pick(FEED_FOCUS, o.focus)];
    if (o.extra.trim()) parts.push(o.extra.trim());
    return parts.join(' ');
}

/** Effective style text of a stored feed style {mode:'builder'|'custom', builder, text}. '' = nothing to add. */
export function feedStyleText(s) {
    if (!s) return '';
    if (s.mode === 'custom') return String(s.text || '').trim().slice(0, 2000);
    if (s.mode === 'builder') return buildFeedStyle(s.builder);
    return '';
}

/** Appended to the fixed system prompt of recaps/briefings. */
export function styleSuffix(text) {
    const t = String(text || '').trim();
    return t ? `\nThe reader’s style preferences (follow them, but keep the output format above exactly): ${t}` : '';
}

/** Resolve which stored style applies to a scope: 'briefing' | 'recap' (recap falls back to briefing). */
export function resolveFeedStyle(cfg, scope) {
    if (!cfg) return '';
    if (scope === 'recap' && cfg.recap) return feedStyleText(cfg.recap);
    return feedStyleText(cfg.briefing);
}
