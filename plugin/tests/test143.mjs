// A capital letter at the end of a hyphenated name is a sentence ending, not a person's initial.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w } = setup({});
const opening = "I don't think the future looks like Wall-E.";
const sentence = 'I think it looks like insanely healthy people able to pursue their passions with a level of rigour and capability that has never existed before.';
const prefix = 'I think it looks like insanely healthy people able to pursue their passions';
const source = opening + ' ' + sentence;
const { resolveHighlightSelections } = await imp('content/highlightSentences.js');
assert.deepEqual(resolveHighlightSelections([prefix], source, 'en'), [{ prefix, text: sentence, status: 'resolved' }], 'the Wall-E period must not pull the preceding sentence into the selected span');
assert.deepEqual(resolveHighlightSelections([prefix], source, 'en', false, sentence), [{ prefix, text: sentence, status: 'resolved' }], 'a chunk containing the entire selected sentence is sufficient');
const segmenter = Intl.Segmenter;
try {
  Intl.Segmenter = undefined;
  assert.equal(resolveHighlightSelections([prefix], source, 'en')[0].text, sentence, 'fallback segmentation also preserves the Wall-E sentence boundary');
  assert.equal(resolveHighlightSelections(['Rivera predicts'], 'A. Rivera predicts steady growth. Others disagree.', 'en')[0].text, 'A. Rivera predicts steady growth.', 'genuine standalone initials still belong to the name');
} finally { Intl.Segmenter = segmenter; }
const { finalizeSummary } = await imp('content/finalize.js');
const result = await finalizeSummary({ raw: '<p>Insight.</p><!-- GHOST_HIGHLIGHTS: ' + JSON.stringify([prefix]) + ' -->', contentText: source, htmlLang: 'en' });
assert.deepEqual(result.ghostQuotes, [sentence]);
document.body.innerHTML = '<article><p>'+opening+'</p><p>I think it looks like insanely <strong>healthy people</strong> able to pursue their passions with a level of rigour and capability that has never existed before.</p></article>';
chrome.runtime.id = 'abc';
const { applyGhostHighlights } = await imp('content/highlighter.js');
assert.equal(applyGhostHighlights(result.ghostQuotes)[0].status, 'matched');
assert(!document.querySelector('article p:first-child .ai-ghost-highlight'), 'the preceding sentence remains unmarked');
assert.equal([...document.querySelectorAll('.ai-ghost-highlight')].map(mark => mark.textContent).join(''), sentence, 'the selected sentence paints completely across inline DOM nodes');
console.log('TEST 143 OK');
w.close();
