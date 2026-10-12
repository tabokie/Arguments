// PDF source matching retains detection helpers, while page analysis and saved-result views ignore retired scholarly metadata.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
const { detectPaper, normalizeDoi, paperIndexFields } = await imp('content/paper.js');
const popupBody = d.body.innerHTML;
const loc = (u) => { const x = new URL(u); return { href: x.href, hostname: x.hostname, pathname: x.pathname, origin: x.origin }; };
const page = (head, body = '') => { d.head.innerHTML = head; d.body.innerHTML = body; };
// DOI normalisation
assert.equal(normalizeDoi('https://doi.org/10.1038/s41562-026-0000-0.'), '10.1038/s41562-026-0000-0');
assert.equal(normalizeDoi('doi:10.1000/xyz123)'), '10.1000/xyz123'); assert.equal(normalizeDoi('no doi here'), '');
// publisher meta → yes + details
page('<meta name="citation_title" content="Sleep and memory"><meta name="citation_journal_title" content="Nature Human Behaviour"><meta name="citation_doi" content="10.1038/s41562-026-0000-0"><meta name="citation_author" content="Smith, J."><meta name="citation_author" content="Lee, K."><meta name="citation_author" content="Rao, P."><meta name="citation_author" content="Zed, Q."><meta name="citation_publication_date" content="2026/03/02">');
let p = detectPaper(d, loc('https://www.nature.com/articles/s41562-026-0000-0'));
assert.deepEqual(p, { state: 'yes', doi: '10.1038/s41562-026-0000-0', journal: 'Nature Human Behaviour', year: '2026', authors: 'Smith, J.; Lee, K.; Rao, P. et al.' });
assert.deepEqual(paperIndexFields(p), { paper: 'yes', doi: '10.1038/s41562-026-0000-0', paperAuthors: 'Smith, J.; Lee, K.; Rao, P. et al.' });
// arXiv: preprint
page('<meta name="citation_title" content="Scaling laws"><meta name="citation_arxiv_id" content="2610.00000"><meta name="citation_author" content="Chen, W.">');
p = detectPaper(d, loc('https://arxiv.org/abs/2610.00000'));
assert(p.state === 'yes' && p.preprint === true); assert.equal(paperIndexFields(p).preprint, true);
// JSON-LD ScholarlyArticle
page('<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["ScholarlyArticle"],"headline":"X","identifier":{"propertyID":"doi","value":"10.1234/abc.5"},"datePublished":"2025-01-02","isPartOf":{"name":"J. Testing"}}]}</script>');
p = detectPaper(d, loc('https://example.org/paper/5'));
assert(p.state === 'yes' && p.doi === '10.1234/abc.5' && p.journal === 'J. Testing' && p.year === '2025');
// known host without meta → likely; plain blog → null; broken JSON-LD never throws
page('<script type="application/ld+json">{oops</script>');
assert.equal(detectPaper(d, loc('https://pubmed.ncbi.nlm.nih.gov/123/')).state, 'likely');
assert.equal(detectPaper(d, loc('https://myblog.example/post')), null);
// phys.org style: "DOI: 10.…" label on a news page (plain text or a non-doi.org link) → likely + DOI
page('', '<p>Journal information: Nature</p><p>DOI: <a href="/redirect?x=1">10.1038/s41586-026-12345-6</a></p>');
{ const q = detectPaper(d, loc('https://phys.org/news/2026-10-x.html')); assert.equal(q.state, 'likely'); assert.equal(q.doi, '10.1038/s41586-026-12345-6'); }
// DOI in text: only with an abstract-like opening → likely; a blog quoting a DOI → null
page('', '<p>Abstract. We study X. doi:10.5555/foo.bar</p>');
assert.deepEqual(detectPaper(d, loc('https://uni.example/x')), { state: 'likely', doi: '10.5555/foo.bar' });
page('', '<p>Great read, see 10.5555/foo.bar for details.</p>');
assert.equal(detectPaper(d, loc('https://blog.example/x')), null);
// collectPageMeta carries it; index gets the lean flags
page('<meta name="citation_title" content="T"><meta name="citation_doi" content="10.1234/abc">');
const core = await imp('content/core.js');
const meta = core.collectPageMeta(d, loc('https://pub.example/a'));
assert(!('paper' in meta), 'general page metadata no longer runs scholarly detection');
const { SK } = await imp('modules/storageKeys.js');
const saved = await core.saveToLocalStorage('<p>c</p>', '<p>s</p>', 'https://pub.example/a', 'T', '', [], 'm', 200, undefined, paperIndexFields(meta.paper), meta);
assert(!store[SK.articlesIndex][0].paper && !store[SK.articlesIndex][0].doi && !('meta' in store[SK.articlesIndex][0]), 'new records do not produce scholarly flags');
// Old scholarly metadata is preserved by ordinary status updates, without a scholarly API.
const { default: SM } = await imp('modules/storageManager.js');
const id = store[SK.articlesIndex][0].id;
store[SK.articlesIndex][0].paperOverride = 'no';
assert(await SM.patchArticleStatus([id], { read: true }));
assert.equal(store[SK.articlesIndex][0].paperOverride, 'no');
assert(!('savePaperInfo' in SM) && !('setTags' in SM));
// Summarize bubble shows the badge (live bubble: from meta.paper)
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
chrome.runtime.getURL = (x) => 'chrome-extension://abc/' + x;
chrome.tabs = { query: async () => [], sendMessage: (i, m, cb) => cb && cb({}), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
store[SK.articlesIndex] = [{ id: 'p1', title: 'Paper', url: 'https://x.org/p', timestamp: '2026-10-01T10:00:00Z', summary: '<p>s</p>', paper: 'yes', doi: '10.1234/abc' }, { id: 'n1', title: 'News', url: 'https://x.org/n', timestamp: '2026-10-02T10:00:00Z', summary: '<p>s</p>' }];
store['articles:rec:p1'] = { content: 'c', summary: '<p>s</p>' }; store['articles:rec:n1'] = { content: 'c', summary: '<p>s</p>' };
d.body.innerHTML = popupBody; d.head.innerHTML = '';
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} }); await tick(120);
const bs = [...d.querySelectorAll('#summaryFeed .summary-bubble')];
assert(bs.every(bubble => !bubble.querySelector('.paper, .bubble-tags')), 'stored paper metadata no longer adds badges');
console.log('TEST 62 OK'); process.exit(0);
