// Reopening repairs saved clause-prefix failures against the original archived source without another model request.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { dom, w, store, sent } = setup({});
dom.reconfigure({ url: 'https://example.test/repaired' });
const sentence = 'The release looks promising, but deployment still needs independent review.';
const html = '<p>The release looks promising, but <strong>deployment</strong> still needs independent review.</p>';
const first = 'Shared opening requires independent review.';
const repeated = '<p>'+first+'</p><p>Shared opening requires experienced reviewers.</p>';
const future = 'I think it looks like insanely healthy people able to pursue their passions with a level of rigour and capability that has never existed before.';
const futurePrefix = 'I think it looks like insanely healthy people able to pursue their passions';
const futureHtml = '<p>I don\'t think the future looks like Wall-E. '+future+'</p>';
document.body.innerHTML = '<article>'+html+repeated+futureHtml+'</article>';
globalThis.MutationObserver = w.MutationObserver;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
chrome.runtime.id = 'abc';
chrome.runtime.getURL = p => 'chrome-extension://abc/' + p;
chrome.i18n = { getMessage: () => '' };
store['articles:index'] = [{ id: 'saved', url: 'https://example.test/repaired', timestamp: '2026-10-12T10:00:00Z' }];
const conversation = [{ id: 'turn', q: 'Why?', a: 'Because.' }];
store['articles:rec:saved'] = { content: html + repeated + futureHtml, summary: '<p>Saved insight.</p>', conversation, highlights: [
  { prefix: 'but deployment still needs', text: 'but deployment still needs', status: 'source-unmatched' },
  { prefix: 'An invented clause', text: 'An invented clause', status: 'source-unmatched' },
  { prefix: 'Shared opening', text: 'Shared opening', status: 'source-ambiguous' },
  { prefix: futurePrefix, text: futurePrefix, status: 'source-unmatched' }
] };
await imp('content.js');
for (let i = 0; i < 100 && !document.querySelector('.ai-ghost-highlight'); i++) await tick(30);
assert.equal([...document.querySelectorAll('.ai-ghost-highlight')].map(mark => mark.textContent).join(''), sentence + first + future, 'saved missing and ambiguous prefixes recover and paint their first matches');
assert(!document.querySelectorAll('article p')[2].querySelector('.ai-ghost-highlight'), 'the second source match is not painted');
assert.equal(store['articles:rec:saved'].highlights[0].text, sentence, 'source recovery repairs the saved selection for Chat and later visits');
assert.equal(store['articles:rec:saved'].highlights[0].status, 'resolved');
assert.equal(store['articles:rec:saved'].highlights[1].status, 'source-unmatched', 'invented prefixes remain failures');
assert.equal(store['articles:rec:saved'].highlights[2].text, first, 'previously saved ambiguous prefixes are repaired on reopening');
assert.equal(store['articles:rec:saved'].highlights[3].text, future, 'the saved Wall-E prefix failure is repaired without including the preceding sentence');
assert.deepEqual(store['articles:rec:saved'].conversation, conversation, 'repair preserves stored conversation turns');
assert(!sent.some(message => ['startFetch', 'aiComplete'].includes(message.action)), 'repair does not send another model request');
console.log('TEST 142 OK');
w.close();
process.exit(0);
