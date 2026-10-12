// Feeds AI scoring: prompt asks for labels and scores, an existing rating is never overwritten.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const now = Date.now();
const run = async (rateSetting) => {
  const { store, w } = setup({});
  const $ = s => w.document.querySelector(s);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const mk = (id, ageH, extra = {}) => ({ id, feedId: 's1', title: 'T' + id, link: 'https://x/' + id, published: now - ageH * 3600e3, snippet: 's', read: false, ...extra });
  store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: now }];
  store['feeds:items'] = [mk('a', 0.01), mk('b', 0.02), mk('c', 0.03, { ai: true, sent: 0.9, cat: 'Old' })];
  if (rateSetting !== undefined) store['feeds:settings'] = { rateWithRecap: rateSetting };
  const calls = [];
  globalThis.__ai = (m) => { calls.push(m); return { ok: true, text: 'Overview.\n- x\nMOOD: mixed\nLABELS: 1:Tech | 2:Politics | 3:Ignored\nSCORES: 1:0.8 | 2:-0.6 | 3:-1' }; };
  const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
  fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
  click($('.feed-day-ai')); await tick(80);
  return { items: store['feeds:items'], calls };
};
for (const savedSetting of [undefined, true, false]) {
 const result = await run(savedSetting);
 assert.equal(result.calls.length, 1);
 assert(!/LABELS|SCORES|MOOD:/.test(result.calls[0].system));
 const by = Object.fromEntries(result.items.map(item => [item.id, item]));
 assert(!by.a.ai && !by.a.cat && !by.b.ai && !by.b.cat, 'recaps never rate or categorize items');
 assert.deepEqual([by.c.sent, by.c.cat], [0.9, 'Old'], 'stored metadata remains intact');
}
console.log('TEST 14 OK');
