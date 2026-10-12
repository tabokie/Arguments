// Feeds: reopening uses the cache, new items show a stale hint, scoring with AI from the recap sheet. // @realtime
import { setup, imp, tick } from './harness.mjs';
import assert from 'assert';
const now = Date.now();
const { store, w } = setup({});
const $ = (s) => w.document.querySelector(s), $$ = (s) => [...w.document.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const mk = (id, t, ageH) => ({ id, feedId: 's1', title: t, link: 'https://x.test/' + id, published: now - ageH * 3600e3, snippet: 'snip ' + id, sent: 0, read: false });
store['feeds:subs'] = [{ id: 's1', url: 'https://a/feed', title: 'Alpha', lastFetched: now }];
store['feeds:items'] = [mk('a', 'Good news', 0.01), mk('b', 'Bad news', 0.02), mk('c', 'Meh', 0.03)];
const calls = [];
globalThis.__ai = (m) => { calls.push(m); return m.system.includes('"scores"') || m.system.includes('{"scores"')
  ? { ok: true, text: '```json\n{"scores":[0.8,-0.6,0]}\n```' }
  : { ok: true, text: 'Overview sentence one. Two.\n- Alpha: good thing\n- Alpha: bad thing\nMOOD: mixed\nLABELS: 1:Tech | 2:Politics | 3:"World News"' }; };
const toasts = [];
const uiStub = { showToast: m => toasts.push(m), showScreen() {} };
const fm = await imp('modules/feedManager.js');
fm.initFeedManager(uiStub); await tick(50); await fm.onFeedsScreenShown(uiStub); await tick(50);
const rb = $('.feed-day-ai'); assert.ok(rb, 'recap button');
click(rb); await tick(50);
assert.equal(calls.length, 1);
assert.ok(calls[0].user.includes('[1] Alpha') && calls[0].user.includes('snip'));
assert.ok($('.feed-recap-overview').textContent.startsWith('Overview'));
assert.equal($$('.feed-recap-themes li').length, 2);
assert.ok(Object.keys(store['feeds:recaps']).length === 1, 'cached');
assert(store['feeds:items'].every(item => !item.cat && !item.ai), 'legacy metadata in a recap reply is ignored');
assert.ok(!('labels' in Object.values(store['feeds:recaps'])[0]), 'labels not duplicated in cache');
assert.equal($$('.feed-cat').length, 0, 'category chips removed');
// reopen uses cache
click($('#feedSheetBody .feed-sheet-done')); click($('.feed-day-ai')); await tick(50);
assert.equal(calls.length, 1, 'cache hit');
// new item -> stale hint
store['feeds:items'].push(mk('d', 'New', 0.001));
await fm.onFeedsScreenShown(uiStub); await tick(50);
click($('#feedSheetBody .feed-sheet-done')); click($('.feed-day-ai')); await tick(50);
assert.ok($('.feed-recap-stale'), 'stale hint');
// The cached recap has no scoring controls or mood/category decorations.
assert(!$$('#feedSheetBody .feed-manage-link').some(button => /Score/.test(button.textContent)));
assert.equal($$('.feed-item.has-mood, .feed-cat, .feed-mood').length, 0);
// error path
globalThis.__ai = () => ({ ok: false, error: 'Monthly limit reached' });
click($('#feedSheetBody .feed-sheet-done'));
click($('.feed-day-ai')); await tick(50);
click($('#feedSheetBody .btn-sm')); await tick(50);
assert.ok($('.feed-error').textContent.includes('Monthly'));
console.log('TEST 4 OK');
