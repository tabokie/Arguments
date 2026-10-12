// Feeds keep newest-first order even when cached items are unsorted and retired mood preferences remain saved.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { store, w } = setup({});
const now = Date.now();
store['feeds:subs'] = [{ id: 'feed', title: 'Source', url: 'https://example.test/feed', lastFetched: now }];
store['feeds:items'] = [
  { id: 'oldest', title: 'Oldest', published: now - 7200000 },
  { id: 'newest', title: 'Newest', published: now - 1000 },
  { id: 'middle', title: 'Middle', published: now - 3600000 }
].map(item => ({ ...item, feedId: 'feed', link: 'https://example.test/' + item.id, read: false }));
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', scope: 'feed', mood: 'pos', sort: 'mood' };
store.moodEnabled = true;
const feeds = await imp('modules/feedManager.js');
const ui = { showToast() {}, showScreen() {} };
feeds.initFeedManager(ui);
await feeds.onFeedsScreenShown(ui);
await tick();
assert.deepEqual([...document.querySelectorAll('.feed-item h4')].map(title => title.textContent), ['Newest', 'Middle', 'Oldest']);
assert.equal(store['feeds:items'][0].id, 'oldest', 'display sorting does not rewrite cached items');
assert.equal(store.moodEnabled, true, 'legacy preferences remain stored without affecting the list');
console.log('TEST 138 OK');
w.close();
