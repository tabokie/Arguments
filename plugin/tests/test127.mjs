// The existing highlights panel safely displays complete failure information without becoming page input.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w } = setup({});
document.body.innerHTML = '<article><p>Original page text.</p></article>';
const { hlpRender } = await imp('content/highlightPanel.js');
const { getAllTextContent } = await imp('content/extractor.js');
const failures = [
  { text: 'A matched claim.', status: 'matched' },
  { text: 'A sentence missing from the webpage.', status: 'unmatched' },
  { text: '<img src=x onerror="bad()"> is literal source text.', status: 'source-unmatched' },
  { text: 'A repeated claim.', status: 'ambiguous' },
  { text: 'A disabled claim.', status: 'disabled' },
  { text: 'An unavailable claim.', status: 'unavailable' }
];
const items = failures.map((item, index) => ({ ...item, id: String(index), type: 'ghost', matchStatus: item.status, status: 'lost', frac: null, saved: true }));
hlpRender(items, { hasSummary: true, chat() {} });
const host = document.getElementById('aish-hl-host');
assert(host && !host.shadowRoot.querySelector('.panel'), 'the existing highlights disclosure starts closed');
assert(host.shadowRoot.querySelector('.pill').textContent.includes('3 not matched'), 'only matching failures contribute to the visible count');
host.shadowRoot.querySelector('.pill').click();
assert.equal(host.shadowRoot.querySelectorAll('.item').length, 6, 'all saved selections remain accessible');
assert.equal(host.shadowRoot.querySelector('[data-match-status="unmatched"] .meta').textContent, 'Not found on page');
assert.equal(host.shadowRoot.querySelector('[data-match-status="source-unmatched"] .meta').textContent, 'Prefix not found in source');
assert.equal(host.shadowRoot.querySelector('[data-match-status="ambiguous"] .meta').textContent, 'Multiple page matches');
assert(!host.shadowRoot.querySelector('img, script'), 'source text is escaped');
assert(!host.shadowRoot.querySelector('[data-match-status="matched"] .failure'));
assert(!host.shadowRoot.querySelector('[data-match-status="disabled"] .failure'));
assert(!getAllTextContent().text.includes('A sentence missing'), 'extension UI never becomes source input');
assert(!document.getElementById('aish-summary-window'), 'there is no redundant floating summary window');
host.shadowRoot.querySelector('.x').click();
assert(!host.shadowRoot.querySelector('.panel'), 'the existing close control dismisses the list');
console.log('TEST 127 OK');
w.close();
