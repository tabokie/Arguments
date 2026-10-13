// Chat opens the requested saved result, including older summaries outside the recent feed, without an AI request.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { dom, w, store, sent } = setup({});
dom.reconfigure({ url: 'chrome-extension://abc/popup.html?surface=sidepanel&chat=old' });
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
chrome.runtime.getURL = p => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://example.test/page', title: 'Page' }],
  sendMessage: (_id, _message, cb) => cb?.({ running: false }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const text = 'A complete saved discovery beyond the preview. '.repeat(8);
store['articles:index'] = Array.from({ length: 15 }, (_, i) => ({ id: 'recent'+i, title: 'Other result', url: 'https://example.test/other'+i, summary: 'Other summary', timestamp: '2026-10-12T12:00:00Z' }));
store['articles:index'].push({ id: 'old', title: 'Requested saved result', url: 'https://example.test/page', timestamp: '2026-09-01T10:00:00Z', summary: '<p>'+text+'</p>' });
store['articles:rec:old'] = { summary: '<p>'+text+'</p><script>bad()</script><a href="javascript:bad()">Unsafe link</a>', content: '<p>Page source.</p>',
  conversation: [{ id: 'turn', q: 'Stored question?', a: 'Stored answer.', sources: [], pinned: true }],
  highlights: [{ text: 'An unmatched saved selection.', status: 'unmatched' }] };
const { initMainScreen } = await imp('modules/mainScreen.js');
initMainScreen({ showScreen() {} });
for (let i = 0; i < 100 && document.querySelector('.controls-bar')?.dataset.state !== 'followup'; i++) await tick(30);
assert.equal(document.querySelectorAll('#summaryFeed .summary-bubble').length, 1, 'the requested summary opens directly');
assert.equal(document.querySelector('.summary-bubble').dataset.id, 'old');
assert(document.querySelector('.summary-bubble-body').textContent.includes(text), 'Chat displays the full summary rather than its preview');
assert(!document.querySelector('.summary-bubble-body script, .summary-bubble-body [href^="javascript:"]'), 'restored summary HTML is sanitized');
assert(document.querySelector('.ask-thread').textContent.includes('Stored answer.'), 'the existing conversation appears below the summary');
assert.equal(document.querySelector('.controls-bar').dataset.state, 'followup');
assert(document.querySelector('.highlights').textContent.includes('Not found on page'), 'saved matching failures remain visible in Chat');
document.querySelector('#convChip .conv-back').click();
await tick(60);
assert.equal(document.querySelector('.controls-bar').dataset.state, 'fetch');
for (const listener of globalThis.__msgL) listener({ action: 'openSavedChat', articleId: 'old' });
for (let i = 0; i < 100 && document.querySelector('.controls-bar').dataset.state !== 'followup'; i++) await tick(30);
assert.equal(document.querySelector('.controls-bar').dataset.state, 'followup', 'Chat resumes an already-open sidebar after Back');
assert.equal(document.querySelectorAll('#summaryFeed .summary-bubble').length, 1, 'reopening Chat does not duplicate the saved summary');
assert(!sent.some(message => ['startFetch', 'aiComplete', 'queueSummary'].includes(message.action)), 'opening Chat makes no model request');
console.log('TEST 140 OK');
w.close();
process.exit(0);
