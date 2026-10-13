// Saved recovery stays within the exact analyzed source, including sentence fragments at the cutoff.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { dom, w, store } = setup({});
dom.reconfigure({ url: 'https://example.test/cutoff' });
const full = 'A claim carries qualifications only beyond the configured page text limit.';
const prefix = 'A claim carries qualifications';
const source = full.slice(0, 30);
document.body.innerHTML = '<article><p>'+full+'</p></article>';
globalThis.MutationObserver = w.MutationObserver;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
chrome.runtime.id = 'abc';
chrome.runtime.getURL = p => 'chrome-extension://abc/' + p;
chrome.i18n = { getMessage: () => '' };
store['articles:index'] = [{ id: 'saved', url: 'https://example.test/cutoff' }];
store['articles:rec:saved'] = { content: '<p>'+full+'</p>', summary: '<p>Insight.</p>',
    analysisSource: { text: source, truncated: true },
    highlights: [{ prefix, text: prefix, status: 'source-unmatched' }] };
await imp('content.js');
for (let i = 0; i < 100 && !document.getElementById('aish-hl-host'); i++) await tick(30);
assert.equal(store['articles:rec:saved'].highlights[0].status, 'source-unmatched', 'reopening cannot recover a sentence outside the analyzed source');
assert(!document.querySelector('.ai-ghost-highlight'), 'the complete archived sentence is not painted');
assert.deepEqual(store['articles:rec:saved'].analysisSource, { text: source, truncated: true });
console.log('TEST 147 OK');
w.close();
process.exit(0);
