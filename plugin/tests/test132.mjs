// Webpage matching paints the first repeated sentence and reports missing sentences and disabled markup.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({});
chrome.runtime.id = 'abc';
document.body.innerHTML = '<article><p>A unique claim remains important. A second claim also matters.</p><p>Repeated claim.</p><p>Repeated claim.</p></article>';
const { applyGhostHighlights, setHighlightingEnabled } = await imp('content/highlighter.js');
const { SK } = await imp('modules/storageKeys.js');
setHighlightingEnabled(true, true);
assert.deepEqual(applyGhostHighlights(['A unique claim remains important.', 'A second claim also matters.', 'Repeated claim.', 'A missing claim.']), [
  { text: 'A unique claim remains important.', status: 'matched' },
  { text: 'A second claim also matters.', status: 'matched' },
  { text: 'Repeated claim.', status: 'matched' },
  { text: 'A missing claim.', status: 'unmatched' }
]);
assert.equal(store[SK.annotations].length, 3, 'repeated sentences produce one annotation');
assert.equal([...document.querySelectorAll('article .ai-ghost-highlight')].map(mark => mark.textContent).join(''), 'A unique claim remains important.A second claim also matters.Repeated claim.', 'matching reports preserve markup for multiple sentences in one text node');
assert(document.querySelectorAll('article p')[1].querySelector('.ai-ghost-highlight'), 'the first repeated occurrence is painted');
assert(!document.querySelectorAll('article p')[2].querySelector('.ai-ghost-highlight'), 'later occurrences are left alone');
assert.deepEqual(applyGhostHighlights(['A unique claim remains important.']), [{ text: 'A unique claim remains important.', status: 'matched' }], 'an already saved annotation remains a successful match');
assert.equal(store[SK.annotations].length, 3, 'a saved match does not duplicate the annotation');
document.querySelector('article').innerHTML = '<p>The page changed.</p>';
assert.deepEqual(applyGhostHighlights(['A unique claim remains important.']), [{ text: 'A unique claim remains important.', status: 'unmatched' }], 'a stored annotation cannot mask a current matching failure');
setHighlightingEnabled(true, false);
assert.deepEqual(applyGhostHighlights(['A missing claim.']), [{ text: 'A missing claim.', status: 'disabled' }], 'disabled highlighting is not a matching failure');
assert.deepEqual(applyGhostHighlights([]), []);
await tick(100);
console.log('TEST 132 OK');
w.close();
