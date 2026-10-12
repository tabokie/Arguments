// Research phase 3 UI: Cite block in the detail view, reference list in the send sheet.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const iso = (d) => new Date(Date.now() - d).toISOString();
const wire = { type: 'article-journal', title: 'Sleep and memory', author: [{ family: 'Smith', given: 'Jane' }], container: 'Nature', volume: '1', issue: '2', page: '3-4', DOI: '10.1038/s41562-026-0000-0', year: '2026' };
store['articles:index'] = [
 { id: 'a1', url: 'https://x.com/1', title: 'Paper one', timestamp: iso(0), summary: '<p>one</p>', tags: [], paper: 'yes', doi: '10.1038/s41562-026-0000-0' },
 { id: 'a2', url: 'https://y.com/2', title: 'News', timestamp: iso(1000), summary: '<p>two</p>', tags: [] },
 { id: 'a3', url: 'https://y.com/3', title: 'Paper no doi', timestamp: iso(2000), summary: '<p>3</p>', tags: [], paper: 'likely' },
];
store['articles:rec:a1'] = { content: 'c', summary: '<p>one</p>', meta: { paper: { state: 'yes', doi: '10.1038/s41562-026-0000-0', csl: wire } } };
store['articles:rec:a2'] = { content: 'c', summary: '<p>two</p>' };
store['articles:rec:a3'] = { content: 'c', summary: '<p>3</p>' };
w.fetch = globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
globalThis.MutationObserver = w.MutationObserver;
const copied = []; Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => copied.push(t) }, configurable: true });
const am = await imp('modules/articleManager.js');
const toasts = []; const ui = { showToast: (m) => toasts.push(m), showScreen() {} };
am.initArticleManager(ui);
am.loadHistory(); await tick(150);
const d = w.document;
// Saved research metadata remains intact, but no research or tag controls render.
await am.showArticleDetail({ ...store['articles:index'][0] }); await tick(100);
assert(!d.querySelector('.cite-block, .detail-tags, .paper-row'));
assert(store['articles:rec:a1'].meta.paper.csl, 'stored citation preserved');
am.loadHistory(); await tick(150);
assert(!d.querySelector('[data-tab="research"], .paper'));
d.getElementById('selectModeBtn').click(); await tick(20);
const cards = [...d.querySelectorAll('#articleList .article-card')]; cards[0].click(); cards[2].click(); await tick(20);
d.querySelector('.sel-bar .sel-send').click(); await tick(150);
assert(![...d.querySelectorAll('.sendsheet-row')].some(row => /Reference list/.test(row.textContent)));
assert([...d.querySelectorAll('.sendsheet-row')].some(row => /Kindle/.test(row.textContent)), 'normal sending remains available');
console.log('TEST 66 OK');
w.close();
