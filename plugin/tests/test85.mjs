// The primary article ignores overlays/scripts, while analysis scope includes all legitimate discussion blocks.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const body = 'Nebius hat CoreWeave beim Börsenwert überholt. '.repeat(40);
const { w } = setup({}); w.document.body.innerHTML = `<div class="overlay display-none"><article class="onetap-popup"><h3>Melde Dich mit Google an.</h3><p>${'Single Sign-on Datenschutz. '.repeat(8)}</p></article></div>
<main><article class="news-container"><h1>CoreWeave vs Nebius</h1><p>${body}</p></article></main>`;
globalThis.document = w.document; globalThis.window = w;
const a = await imp('content/anchor.js'); const x = await imp('content/extractor.js');
assert(a.ancScopeRoot(w.document).classList.contains('news-container'), 'anchor scope picks the story');
const { text } = x.getAllTextContent();
assert(text.includes('Börsenwert') && !text.includes('Single Sign-on'), 'extractor ignores the popup');
w.document.body.innerHTML = '<article id="m"><p>' + body + '</p></article><div role="dialog"><article>' + body + body + '</article></div>'; const d = w.document;
assert.equal(a.ancLargestMatch(d, 'article').id, 'm', 'dialog content is skipped even when larger');
assert.equal(a.ancLargestMatch(d, 'section'), null);
// Roche page: a sibling <article> whose inline <script> is longer than the story must not win (textContent counts script source)
w.document.body.innerHTML = `<div id="onetap"><article class="onetap-popup"><p>${'Google Anmeldung. '.repeat(20)}</p></article></div>
<main><article class="news-container"><h1>Roche Tecentriq</h1><p>${body}</p></article>
<article class="analysen"><h2>Roche Analysen</h2><table><tr><td>Hold</td></tr></table><script>${'var x = 1; '.repeat(800)}</script></article></main>`;
assert(a.ancArticleRoot(w.document).classList.contains('news-container'), 'script source does not displace the primary article');
assert.equal(a.ancScopeRoot(w.document).tagName, 'MAIN', 'analysis scope includes sibling article blocks');
assert(x.getAllTextContent().text.includes('Roche Analysen') && !x.getAllTextContent().text.includes('var x'), 'legitimate analysis content is retained, script source is removed');
// Ordinary pages keep the old first-match result: several articles, first one has the h1 -> first; no h1 anywhere -> first
w.document.body.innerHTML = '<article id="a"><h1>T</h1><p>' + body + '</p></article><article id="b"><h1>Other</h1><p>' + body + body + '</p></article>';
assert.equal(a.ancArticleRoot(w.document).id, 'a', 'first article with h1 remains the primary article');
assert.equal(a.ancScopeRoot(w.document), w.document.body, 'both article topics belong to the analysis scope');
w.document.body.innerHTML = '<article id="a"><p>' + body + '</p></article><article id="b"><p>' + body + body + '</p></article>';
assert.equal(a.ancArticleRoot(w.document).id, 'a', 'no h1 anywhere, primary article keeps its first-match heuristic');
assert.equal(a.ancScopeRoot(w.document), w.document.body, 'both comparable articles remain available');
// no h1 anywhere (h2-only layouts): overlay-looking first article loses to the one with the text; plain first is kept
const big = body.repeat(3);
w.document.body.innerHTML = '<div class="login-overlay"><article id="a"><p>Melde dich an. ' + 'x'.repeat(100) + '</p></article></div><article id="b"><h2>Story</h2><p>' + big + '</p></article>';
assert.equal(a.ancScopeRoot(w.document).id, 'b', 'furniture-looking first article is skipped without an h1');
w.document.body.innerHTML = '<article id="a"><h2>Short note</h2><p>' + body.slice(0, 600) + '</p></article><article id="b"><h2>Second</h2><p>' + body.slice(0, 900) + '</p></article>';
assert.equal(a.ancScopeRoot(w.document), w.document.body, 'two comparable plain articles are both included');
w.document.body.innerHTML = '<article id="a"><h2>Teaser</h2><p>kurz</p></article><article id="b"><h2>Story</h2><p>' + big + '</p></article>';
assert.equal(a.ancArticleRoot(w.document).id, 'b', 'dominant later article remains the primary article');
assert.equal(a.ancScopeRoot(w.document), w.document.body, 'the short independent block is retained too');
console.log('TEST 85 OK'); process.exit(0);
