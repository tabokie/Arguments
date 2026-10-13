// Reopening restores highlights and failures in the original panel; Chat opens the saved result without a new summary.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { dom, w, store, sent } = setup({});
dom.reconfigure({ url: 'https://example.test/item?id=1&utm_source=reopen' });
document.body.innerHTML = '<article><p>A detached argument returns on reopening.</p><p>A dismissed argument stays dismissed.</p><p>A kept argument stays yellow.</p></article>';
globalThis.MutationObserver = w.MutationObserver;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
chrome.runtime.id = 'abc';
chrome.runtime.getURL = p => 'chrome-extension://abc/' + p;
chrome.i18n = { getMessage: () => '' };
chrome.runtime.sendMessage = async message => { sent.push(message); return { success: false }; };
store.highlightingEnabled = false;
const url = 'https://example.test/item?id=1';
const sentence = 'A detached argument returns on reopening.';
store['articles:index'] = [
  { id: 'new', url, timestamp: '2026-10-12T10:00:00Z' },
  { id: 'old', url, timestamp: '2026-10-11T10:00:00Z' },
  { id: 'bookmark', url, timestamp: '2026-10-12T11:00:00Z', savedOnly: true },
  { id: 'other', url: 'https://example.test/item?id=2', timestamp: '2026-10-12T12:00:00Z' }
];
store['articles:rec:new'] = { summary: '<p>Newest saved insight.</p>', highlights: [
  { text: sentence, status: 'unavailable' },
  { text: 'A dismissed argument stays dismissed.', status: 'matched' },
  { text: 'A kept argument stays yellow.', status: 'matched' },
  { text: 'A late argument arrives after rendering.', status: 'unmatched' },
  { text: 'A detached', status: 'source-ambiguous' }
] };
store['articles:rec:old'] = { summary: '<p>Old insight.</p>' };
store['articles:rec:other'] = { summary: '', highlights: [{ text: 'An argument that no longer exists.', status: 'unavailable' }] };
store['hl:all'] = [
  { id: 'dismissed', url, text: 'A dismissed argument stays dismissed.', type: 'ghost', dismissed: true },
  { id: 'kept', url, text: 'A kept argument stays yellow.', type: 'user' }
];
await imp('content.js');
const waitFor = async (fn, label) => {
  for (let i = 0; i < 100 && !fn(); i++) await tick(30);
  assert(fn(), label);
};
await waitFor(() => document.getElementById('aish-hl-host'), 'saved analysis returns in the original highlights control');
const panel = () => document.getElementById('aish-hl-host')?.shadowRoot;
panel().querySelector('.pill').click();
assert(!document.getElementById('aish-summary-window'), 'restoration creates no redundant window');
assert(!document.querySelector('.ai-ghost-highlight'), 'disabled highlighting is respected');
assert(!panel().textContent.includes('A dismissed argument stays dismissed.'), 'dismissed selections stay hidden even when both highlighting switches are off');
await waitFor(() => panel().querySelector('[data-match-status="disabled"]'), 'disabled selections remain readable in the panel');
store.highlightingEnabled = true;
for (const listener of globalThis.__chL) listener({ highlightingEnabled: { newValue: true } }, 'sync');
await waitFor(() => document.querySelector('.ai-ghost-highlight'), 'detached selection is painted');
assert.equal(document.querySelector('.ai-ghost-highlight').textContent, sentence);
assert.equal(document.querySelectorAll('.ai-ghost-highlight').length, 1, 'dismissed and kept selections are not recreated');
await waitFor(() => panel().querySelector('.pill').textContent.includes('2 not matched'), 'source failures and page failures appear in the existing control');
assert(panel().querySelector('[data-match-status="source-ambiguous"]'));
assert(!panel().textContent.includes('A dismissed argument stays dismissed.'), 'dismissed selections stay out of the original panel');
const late = document.createElement('p');
late.textContent = 'A late argument arrives after rendering.';
document.querySelector('article').appendChild(late);
await waitFor(() => document.querySelectorAll('.ai-ghost-highlight').length === 2, 'late rendering reconnects saved sentences');
await waitFor(() => panel().querySelector('.pill').textContent.includes('1 not matched'), 'failure counts update after matching');
let currentMatches;
globalThis.__msgL.forEach(fn => fn({ action: 'getPageHighlightState' }, {}, state => { currentMatches = state; }));
assert.equal(currentMatches.highlights.find(selection => selection.text === late.textContent).status, 'matched', 'Chat can pull updated page matches');
assert(!currentMatches.highlights.some(selection => selection.text === 'A dismissed argument stays dismissed.'), 'Chat and the original panel both omit dismissed selections');
await waitFor(() => sent.some(message => message.action === 'pageHighlightState' && message.highlights.some(selection => selection.text === late.textContent && selection.status === 'matched')), 'late page matches are published for an already-open Chat');
panel().querySelector('.chat').click();
await waitFor(() => document.getElementById('ai-summary-hybrid-sidebar'), 'Chat opens the existing sidebar when a native panel is unavailable');
assert.equal(sent.find(message => message.action === 'openNativeSidePanel').articleId, 'new', 'the newest analysis wins over a newer bookmark');
assert.equal(new URL(document.getElementById('ai-summary-hybrid-sidebar').src).searchParams.get('chat'), 'new');
dom.reconfigure({ url: 'https://example.test/item?id=2' });
w.dispatchEvent(new w.PopStateEvent('popstate'));
await waitFor(() => panel()?.querySelector('.pill').textContent.includes('1 not matched') && panel()?.textContent.includes('An argument that no longer exists.'), 'all-unmatched results remain visible after navigation');
dom.reconfigure({ url: 'https://example.test/unsummarized' });
w.dispatchEvent(new w.PopStateEvent('popstate'));
await waitFor(() => !document.getElementById('aish-hl-host'), 'navigation removes the previous analysis');
assert(!sent.some(message => message.action === 'startFetch'), 'opening Chat never requests another summary');
console.log('TEST 139 OK');
w.close();
process.exit(0);
