// Discussion extraction covers multiple articles and Hacker News comment bodies, with matching on the same scope.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w } = setup({});
const { getAllTextContent } = await imp('content/extractor.js');
const { ancScopeRoot, ancBuildIndex, ancResolve, ancToRange, ancQuoteUsable } = await imp('content/anchor.js');
const { resolveHighlightPrefixes } = await imp('content/highlightSentences.js');
document.body.innerHTML = `<main><article><h1>First discussion</h1><p>${'Background context. '.repeat(40)}</p></article><article><p>Second discussion needs a different policy.</p></article><div id="comments"><div class="reply"><p>Comments present another independent argument.</p></div></div></main>`;
let source = getAllTextContent().text;
assert(source.includes('Second discussion needs'), 'a long first article must not hide other discussion blocks');
assert(source.includes('Comments present'), 'comments are content, not noise');
assert(ancResolve(ancBuildIndex(ancScopeRoot()), { exact: 'Comments present another independent argument.' }), 'comment sentences remain anchorable');
document.body.innerHTML = `<div id="content"><article><p>${'Background context. '.repeat(40)}</p></article></div><article><p>Second discussion needs a different policy.</p></article><div class="comments"><p>Comments present another independent argument.</p></div><div role="dialog"><article><p>Comments present another independent argument.</p></article></div>`;
source = getAllTextContent().text;
assert(source.includes('Second discussion needs') && source.includes('Comments present'), 'a content-id shortcut must not narrow an expanded multi-block scope');
assert(ancQuoteUsable(ancBuildIndex(ancScopeRoot()), 'Comments present another independent argument.'), 'modal copies cannot create false ambiguity in an expanded scope');

// Hacker News uses nested tables, not article/main elements; metadata is outside each .commtext.
const row = (id, indent, body) => `<tr class="athing comtr" id="${id}"><td><table><tbody><tr><td class="ind" indent="${indent}"></td><td class="votelinks">VOTE_CONTROL</td><td class="default"><span class="comhead">USER_TIME_CONTROL</span><div class="comment"><div class="commtext c00">${body}</div><div class="reply">REPLY_CONTROL</div></div></td></tr></tbody></table></td></tr>`;
document.body.innerHTML = `<table id="hnmain"><tbody><tr><td>HEADER_CONTROL</td></tr><tr><td><table class="fatitem"><tbody><tr><td><span class="titleline"><a>Discussion title</a></span></td></tr><tr><td><div class="toptext">The original post makes a distinct claim.</div></td></tr></tbody></table><table class="comment-tree"><tbody>${row('1',0,'First topic has <i>important</i> consequences.<p>A qualification remains part of the discussion.</p>')}${row('2',1,'A nested reply challenges that conclusion.')}${row('3',0,'Another thread recommends a different policy.')}</tbody></table></td></tr><tr><td>FOOTER_CONTROL</td></tr></tbody></table><div data-aish-ui="1">EXTENSION_CONTROL</div>`;
source = getAllTextContent().text;
for (const text of ['Discussion title','The original post','First topic has important consequences.','A nested reply','Another thread']) assert(source.includes(text), text);
assert(!source.includes('_CONTROL'), 'navigation, usernames, voting and reply controls never enter the model source');
const selections = resolveHighlightPrefixes(['First topic', 'A nested reply', 'Another thread'], source, 'en');
assert.equal(selections.length, 3, 'separate Hacker News comments retain independent sentence boundaries');
const index = ancBuildIndex(ancScopeRoot());
for (const text of selections) {
  const match = ancResolve(index, { exact: text });
  assert(match, text);
  const range = ancToRange(index, match.start, match.end);
  assert.equal(range.toString(), text, 'complete sentences match across inline Hacker News markup');
  assert(range.startContainer.parentElement.closest('.commtext'), 'the range starts inside a comment body');
}
console.log('TEST 133 OK');
w.close();
