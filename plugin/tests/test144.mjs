// Reopening also repairs an incorrect sentence expansion saved as a page matching failure.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { dom, w, store } = setup({});
dom.reconfigure({ url: 'https://example.test/future' });
const opening = "I don't think the future looks like Wall-E.";
const sentence = 'I think it looks like insanely healthy people able to pursue their passions with a level of rigour and capability that has never existed before.';
const prefix = 'I think it looks like insanely healthy people able to pursue their passions';
const unchanged = { prefix: 'A missing claim', text: 'A missing claim needs verification.', status: 'unmatched' };
// The source captured for the model had both sentences; only the selected sentence is now on the live page.
document.body.innerHTML = '<article><p>'+sentence+'</p></article>';
globalThis.MutationObserver = w.MutationObserver;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
chrome.runtime.id = 'abc';
chrome.runtime.getURL = p => 'chrome-extension://abc/' + p;
chrome.i18n = { getMessage: () => '' };
store['articles:index'] = [{ id: 'saved', url: 'https://example.test/future', timestamp: '2026-10-12T10:00:00Z' }];
store['articles:rec:saved'] = {
  content: '<p>'+opening+' '+sentence+'</p><p>A missing claim needs verification.</p>', summary: '<p>Saved insight.</p>',
  highlights: [{ prefix, text: opening+' '+sentence, status: 'unmatched' }, unchanged]
};
await imp('content.js');
for (let i = 0; i < 100 && !document.querySelector('.ai-ghost-highlight'); i++) await tick(30);
assert.equal(document.querySelector('.ai-ghost-highlight')?.textContent, sentence, 'a previously merged span is corrected before page matching');
assert.equal(store['articles:rec:saved'].highlights[0].text, sentence);
assert.equal(store['articles:rec:saved'].highlights[0].status, 'resolved');
assert.deepEqual(store['articles:rec:saved'].highlights[1], unchanged, 'an unchanged span that is actually absent from the page remains a matching failure');
console.log('TEST 144 OK');
w.close();
process.exit(0);
