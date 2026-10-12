// Retired metadata preferences cannot restore controls or automatic jobs; saved graph layouts migrate to List and Analytics.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w, store } = setup({});
const { SK } = await imp('modules/storageKeys.js');
store.moodEnabled = true;
store[SK.workspace] = { layout: 3, views: ['graph', 'report', 'list'] };
Object.defineProperty(w, 'innerWidth', { value: 1200, configurable: true });
assert.equal(store.moodEnabled, true, 'legacy preference remains stored');
const workspace = await imp('modules/workspaceManager.js');
await workspace.initWorkspace();
assert.equal(workspace.maxPanes(), 2);
assert.equal(document.querySelectorAll('.ws-seg button').length, 2);
assert(document.querySelectorAll('.ws-select').length > 0);
for (const select of document.querySelectorAll('.ws-select')) {
  assert.deepEqual([...select.options].map(option => option.value), ['list', 'report']);
}
assert(!document.querySelector('#graphToggleBtn, #detailGraphToggleBtn, #feedGraphBtn, #graphScopeInlineToggle, #graphContainer, #feedGraph'));
document.querySelector('#historyScreen .ws-close').click();
assert.equal(store[SK.workspace].layout, 1);
assert.deepEqual(store[SK.workspace].views.slice().sort(), ['list', 'report']);

const { planLibrary, countRequests } = await imp('modules/libraryBatch.js');
const day = 86400000;
const plan = planLibrary({ metadata: false, rateWithRecap: true,
  items: [{ id: 'one', feedId: 'feed', title: 'A claim', published: day }],
  recaps: {}, source: 'all', inSource: () => true, today: day * 2,
  startOfDay: timestamp => timestamp, itemSig: item => item.id,
  subs: [{ id: 'feed', topics: [] }], topicLang: 'en', articleTags: ['Unknown legacy topic']
});
assert.deepEqual(Object.keys(plan), ['days']);
assert.equal(plan.days.length, 1, 'recap processing remains available');
assert.equal(countRequests(plan, 20), 1, 'no hidden metadata requests');
console.log('TEST 136 OK');
w.close();
