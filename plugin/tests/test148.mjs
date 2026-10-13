// Chat pulls current page matches, receives tab-scoped updates, and applies the configured cap to real requests.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { dom, w, store, sent } = setup({});
dom.reconfigure({ url: 'chrome-extension://abc/popup.html?surface=sidepanel&chat=saved&pageTab=7' });
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
chrome.runtime.getURL = p => 'chrome-extension://abc/' + p;
const url = 'https://example.test/page';
const sentence = 'A previously missing claim is now present on the page.';
const state = { articleId: 'saved', url, highlights: [{ text: sentence, status: 'matched' }] };
chrome.tabs = { query: async () => [{ id: 7, url, title: 'Page' }],
    sendMessage: (id, message, cb) => { assert.equal(id, 7); cb(message.action === 'getPageHighlightState' ? state : { running: false }); },
    onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
store['articles:index'] = [{ id: 'saved', title: 'Page', url, timestamp: new Date().toISOString(), summary: '<p>Insight.</p>' }];
store['articles:rec:saved'] = { content: '<p>'+'X'.repeat(25000)+'</p>', summary: '<p>Insight.</p>', highlights: [{ text: sentence, status: 'unmatched' }] };
store.pageTextLimit = 1000;
let chatPageText;
globalThis.__ai = message => { chatPageText = message.user.split('PAGE TEXT:\n')[1].split('\n\nMAIN OUTPUT:')[0]; return { ok: true, text: 'Answer.' }; };
const { initMainScreen } = await imp('modules/mainScreen.js');
initMainScreen({ showScreen() {} });
const waitFor = async (fn, message) => { for (let i = 0; i < 100 && !fn(); i++) await tick(30); assert(fn(), message); };
await waitFor(() => document.querySelector('.controls-bar').dataset.state === 'followup', 'saved Chat opens');
await waitFor(() => document.querySelector('.highlights [data-match-status="matched"]'), 'Chat replaces the stored failure with current matches');
assert(!document.querySelector('.highlights .failure'));
const update = { action: 'pageHighlightState', ...state, highlights: [{ text: sentence, status: 'unmatched' }] };
globalThis.__msgL.forEach(fn => fn(update, { tab: { id: 8 } }));
await tick();
assert(document.querySelector('.highlights [data-match-status="matched"]'), 'another tab cannot replace current matches');
globalThis.__msgL.forEach(fn => fn(update, { tab: { id: 7 } }));
await waitFor(() => document.querySelector('.highlights [data-match-status="unmatched"]'), 'Chat updates when a page match changes');
document.getElementById('additionalQuestions').value = 'Why?';
document.getElementById('fetchSummary').click();
await waitFor(() => sent.some(message => message.action === 'aiComplete'), 'follow-up request starts');
await waitFor(() => !document.getElementById('fetchSummary').disabled, 'follow-up finishes');
assert.equal(chatPageText.length, 1000, 'the Chat request uses the configured page input cap');
assert(!sent.some(message => message.action === 'startFetch'), 'current match updates do not summarize again');
console.log('TEST 148 OK');
w.close();
process.exit(0);
