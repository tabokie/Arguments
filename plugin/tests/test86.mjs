// Manual follow-up questions work without automatic suggestions or cached short answers.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({});
const d = w.document;
store.connectionMode = 'cloud'; store.activeService = 'ollama';
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
w.HTMLElement.prototype.scrollIntoView = function () {};
chrome.runtime.getURL = path => 'chrome-extension://abc/' + path;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page' }],
 sendMessage: (_id, message, callback) => callback?.(message.action === 'getSummaryState' ? { running: false } : { success: true }),
 onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
let calls = 0;
globalThis.__ai = message => {
 calls++;
 assert(!message.system.includes('QUESTIONS:'));
 assert(message.user.includes('QUESTION: Who paid for it?'));
 return { ok: true, text: 'The city funded construction.\nSOURCES: "The city paid for construction from its annual budget"\nQUESTIONS: [{"q":"What next?","a":"A stale automatic answer."}]' };
};
const { initMainScreen } = await imp('modules/mainScreen.js');
initMainScreen({ showScreen() {} });
await tick(150);
for (const listener of globalThis.__msgL) listener({ action: 'summaryComplete', url: 'https://a.example.com/x', title: 'T', summary: '<div><h2>T</h2><p>Main output.</p></div>',
 content: '<p>The city paid for construction from its annual budget.</p>', tags: ['Legacy'], moodScore: 0.8,
 meta: { paper: { state: 'yes' } }, questions: ['Who paid for it?'], quick: { 'Who paid for it?': 'A stale cached answer.' } }, {});
await tick(150);
assert(!d.querySelector('.chat-suggest-chip, .bubble-tags, .paper'));
assert.equal(calls, 0, 'completion does not request follow-up answers');
d.getElementById('additionalQuestions').value = 'Who paid for it?';
d.getElementById('fetchSummary').click();
await tick(250);
assert.equal(calls, 1, 'the manually entered question requests one answer');
assert(d.querySelector('.chat-turn-group').textContent.includes('The city funded construction.'));
assert(d.querySelector('.chat-src'), 'source passages remain available');
assert(!d.querySelector('.chat-suggest-chip, .chat-dig, .chat-a--quick'), 'old suggestion metadata never recreates retired controls');
console.log('TEST 86 OK');
w.close();
