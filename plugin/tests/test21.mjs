// Feeds retention setting: pruning old items, month scope reads from the store.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d.getTime(); };
const { store, w } = setup({});
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
let n = 0;
const mk = (d, sent, cat, ai = true) => ({ id: 'i' + (n++), feedId: 's1', title: 'T' + n, link: 'https://x/' + n, published: d + 10 * 3600e3, snippet: 's', read: false, ai, sent: ai ? sent : undefined, cat });
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: Date.now() }];
// this week (today) 6 rated: 4 pos 2 neg ; old (60 days ago) 6 rated: all neu — older than keepDays=30 → pruned, but mood must survive
const cur = []; for (let k = 0; k < 4; k++) cur.push(mk(day(0), 0.8, 'Tech')); for (let k = 0; k < 2; k++) cur.push(mk(day(0), -0.8, 'World'));
cur.push(mk(day(0), 0, undefined, false), mk(day(0), 0, undefined, false));
const old = []; for (let k = 0; k < 6; k++) old.push(mk(day(60), 0, 'Tech'));
store['feeds:items'] = [...cur, ...old];
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'feed' };
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
assert.equal(store['feeds:items'].length, 14, 'opening cached feeds preserves saved items');
click($('#feedInsightsBtn')); await tick(50);
assert(!$('.feed-mt') && !$('.ar-topics'), 'mood and topic analytics are removed');
assert($('#feedInsights .ar-chart'), 'volume analytics remain available');
console.log('TEST 21 OK');
