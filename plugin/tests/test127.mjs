// Completed summaries have one isolated, dismissible window; page extraction excludes the window.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w } = setup({});
w.document.body.innerHTML = '<button id="origin">Read</button><article><p>Original page text.</p></article>';
const origin = document.getElementById('origin');
origin.focus();
const { showSummaryWindow } = await imp('content/summaryWindow.js');
const { getAllTextContent } = await imp('content/extractor.js');
const first = showSummaryWindow('<h2>Finding</h2><p>A useful claim.</p><script>bad()</script><img src=x onerror="bad()">');
assert.equal(first.style.position, 'fixed');
assert.equal(first.style.right, '16px');
assert.equal(first.style.bottom, '16px');
assert.equal(document.activeElement, origin, 'completion preserves the reader’s focus');
assert.equal(first.shadowRoot.querySelector('.body').textContent, 'FindingA useful claim.');
assert(!first.shadowRoot.querySelector('script, img'), 'untrusted HTML is sanitized');
assert.equal(first.shadowRoot.querySelector('section').getAttribute('role'), 'dialog');
assert.equal(first.shadowRoot.querySelector('button').getAttribute('aria-label'), 'Close');
assert(!getAllTextContent().text.includes('A useful claim'), 'the summary never becomes page input');

chrome.i18n = { getMessage: key => key === 'f_highlights_fa5c' ? 'Markierungen' : '' };
const sentences = ['A sentence missing from the webpage.', '<img src=x onerror="bad()"> is literal source text.', ...Array.from({ length: 12 }, (_, index) => `Complete source claim ${index + 1}.`)];
const second = showSummaryWindow('<p>A later claim.</p>', sentences);
assert(!first.isConnected, 'the latest completion replaces the previous window');
assert.equal(document.querySelectorAll('#aish-summary-window').length, 1);
const highlights = second.shadowRoot.querySelector('details.highlights');
assert(highlights && !highlights.open, 'highlights start collapsed');
assert.equal(highlights.querySelector('summary').textContent, 'Markierungen (14)', 'the existing Highlights translation is used with the complete count');
assert.deepEqual([...highlights.querySelectorAll('li')].map(item => item.textContent), sentences, 'every complete sentence stays readable independently of webpage markup');
assert(!highlights.querySelector('img, script'), 'source sentences render as safe text');
highlights.querySelector('summary').click();
assert(highlights.open, 'the native disclosure opens the highlights');
highlights.querySelector('summary').click();
assert(!highlights.open, 'the highlights can be collapsed again');
assert(!getAllTextContent().text.includes(sentences[0]), 'highlight fallback text never becomes page input');
const close = second.shadowRoot.querySelector('button');
close.focus();
close.click();
assert(!second.isConnected, 'close button dismisses the window');
assert.equal(document.activeElement, origin, 'closing restores focus');

const failures = showSummaryWindow('<p>Insight.</p>', [
  { text: 'A matched claim.', status: 'matched' },
  { text: 'A missing claim.', status: 'unmatched' },
  { text: 'A repeated claim.', status: 'ambiguous' },
  { text: 'A disabled claim.', status: 'disabled' },
  { text: 'An unavailable claim.', status: 'unavailable' }
]);
const failureSection = failures.shadowRoot.querySelector('.highlights');
assert(!failureSection.open, 'failures do not force the section open');
assert.equal(failureSection.querySelector('summary .failure').textContent, '2 not matched', 'the collapsed section counts only matching failures');
assert.equal(failureSection.querySelector('[data-match-status="unmatched"] .match-status').textContent, 'Not found on page');
assert.equal(failureSection.querySelector('[data-match-status="ambiguous"] .match-status').textContent, 'Multiple page matches');
assert(!failureSection.querySelector('[data-match-status="matched"] .match-status'), 'successful matches do not get failure badges');
assert(!failureSection.querySelector('[data-match-status="disabled"] .failure') && !failureSection.querySelector('[data-match-status="unavailable"] .failure'), 'disabled and unavailable markup are neutral states');
assert.equal(failureSection.querySelector('[data-match-status="unmatched"] .highlight-sentence').textContent, 'A missing claim.', 'failure labels preserve the complete readable sentence');
const third = showSummaryWindow('<p>Another claim.</p>');
assert(!third.shadowRoot.querySelector('details'), 'empty selections do not leave an empty highlight section');
third.shadowRoot.querySelector('button').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
assert(!third.isConnected, 'Escape dismisses the focused window');
console.log('TEST 127 OK');
w.close();
