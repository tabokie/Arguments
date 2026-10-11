// Prefixes resolve only to complete, unambiguous source sentences, across source blocks and languages.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w } = setup({});
const { resolveHighlightPrefixes, resolveHighlightSelections } = await imp('content/highlightSentences.js');
const source = 'Costs will fall only if demand stays stable. Costs will rise if demand accelerates.\n\nA second topic needs a different policy, with important qualifications.';
assert.deepEqual(resolveHighlightPrefixes(['Costs will fall', 'A second topic'], source, 'en'), [
  'Costs will fall only if demand stays stable.', 'A second topic needs a different policy, with important qualifications.'
]);
assert.deepEqual(resolveHighlightPrefixes(['Costs will', 'will fall', 'Invented claim', '', {}, 12], source, 'en'), [], 'ambiguous prefixes, interior fragments and non-source text are rejected');
assert.deepEqual(resolveHighlightPrefixes(['Costs will fall', 'Costs will fall only if demand stays stable.'], source, 'en'), ['Costs will fall only if demand stays stable.'], 'overlapping prefixes and full-sentence model replies resolve once');
assert.deepEqual(resolveHighlightPrefixes(['Costs will fall'], source + '\n\nCosts will fall only if demand stays stable.', 'en'), ['Costs will fall only if demand stays stable.'], 'identical repeated sentences are one selection');
assert.deepEqual(resolveHighlightPrefixes(['A claim crosses'], 'A claim crosses\na wrapped line, but keeps its qualifications. Another claim.', 'en'), ['A claim crosses a wrapped line, but keeps its qualifications.']);
assert.deepEqual(resolveHighlightPrefixes(['Unpunctuated'], 'Unpunctuated argument\n\nUnrelated block', 'en'), ['Unpunctuated argument'], 'block boundaries do not merge unrelated text');
const scholarly = 'Dr. Rivera predicts 3.5% growth. Markets disagree.';
assert.deepEqual(resolveHighlightPrefixes(['Dr. Rivera'], scholarly, 'en'), ['Dr. Rivera predicts 3.5% growth.'], 'honorifics and decimal points remain inside the complete sentence');
assert.deepEqual(resolveHighlightPrefixes(['他说：'], '他说：“这个方案值得采用。”另一个观点完全不同。', 'zh'), ['他说：“这个方案值得采用。”']);
assert.deepEqual(resolveHighlightPrefixes(['この方法'], 'この方法は有効です。しかし条件があります。', 'ja'), ['この方法は有効です。']);
assert.deepEqual(resolveHighlightPrefixes(['هل'], 'هل هذا مفيد؟ نعم، بشرط واضح.', 'ar'), ['هل هذا مفيد؟']);
assert.deepEqual(resolveHighlightPrefixes(['会涨'], '会涨。不会跌。', 'zh'), ['会涨。'], 'short sentences in languages without word spaces are kept');
assert.deepEqual(resolveHighlightPrefixes(['Tail'], 'An earlier complete claim. Tail is cut mid-sentence', 'en', true), [], 'input truncation never produces a partial-sentence highlight');
assert.deepEqual(resolveHighlightPrefixes(null, source), []);
const wrappedSource = 'A claim crosses\na wrapped line, with a qualification.';
assert.equal(resolveHighlightSelections(['A claim crosses'], wrappedSource, 'en', false, 'A claim crosses\n\na wrapped line, with a qualification.')[0].text, 'A claim crosses a wrapped line, with a qualification.', 'chunk boundaries do not shorten original source sentences');
assert.equal(resolveHighlightSelections(['A claim crosses'], wrappedSource, 'en', false, 'A claim crosses')[0].status, 'source-unmatched', 'a sentence cut across chunks is not represented as a complete argument');
const segmenter = Intl.Segmenter;
try {
  Intl.Segmenter = undefined;
  assert.deepEqual(resolveHighlightPrefixes(['Dr. Rivera', '市场'], scholarly + '\n\n市场会增长。其他事情不变。', 'en'), ['Dr. Rivera predicts 3.5% growth.', '市场会增长。'], 'sentence resolution also works without Intl.Segmenter');
} finally { Intl.Segmenter = segmenter; }
// Extraction preserves source blocks and inline markup; the expanded sentence then anchors to the original DOM.
document.body.innerHTML = '<article><h1>Unrelated heading</h1><p>A qualifying <strong>argument</strong> continues\nacross source lines, only under strict conditions.</p><p>Another topic without punctuation</p><p>A separate block without punctuation</p><script>A qualifying fake argument.</script></article>';
const { getAllTextContent } = await imp('content/extractor.js');
const { ancBuildIndex, ancResolve, ancToRange, ancQuoteUsable } = await imp('content/anchor.js');
const text = getAllTextContent().text;
assert(text.includes('Unrelated heading\n\nA qualifying argument'), 'adjacent DOM blocks have explicit boundaries');
assert(!text.includes('fake argument'), 'script noise never enters prefix resolution');
const [sentence] = resolveHighlightPrefixes(['A qualifying'], text, 'en');
assert.equal(sentence, 'A qualifying argument continues across source lines, only under strict conditions.');
const index = ancBuildIndex(document.querySelector('article'));
const match = ancResolve(index, { exact: sentence });
assert.equal(ancToRange(index, match.start, match.end).toString().replace(/\s+/gu, ' '), sentence, 'the full sentence anchors across inline DOM nodes');
assert.deepEqual(resolveHighlightPrefixes(['Another topic'], text, 'en'), ['Another topic without punctuation']);
document.querySelector('article').innerHTML = '<p>会涨。不会跌。</p>';
assert.equal(ancQuoteUsable(ancBuildIndex(document.querySelector('article')), '会涨。'), '会涨。');
const { finalizeSummary } = await imp('content/finalize.js');
const final = await finalizeSummary({ raw: '<p>Insight.</p><!-- GHOST_HIGHLIGHTS: ["Unseen argument", "Seen argument"] -->', contentText: 'Seen argument qualifies. Unseen argument also qualifies.', highlightSourceText: 'Seen argument qualifies.', selectedLanguage: 'en', pageMeta: {} });
assert.deepEqual(final.ghostQuotes, ['Seen argument qualifies.'], 'resolution searches only the source actually sent to the model');
console.log('TEST 131 OK');
w.close();
