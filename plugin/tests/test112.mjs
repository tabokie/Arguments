// Feed AI and background APIs expose recaps without retired topic, rating, or naming jobs.
import assert from 'assert';
import { imp } from './harness.mjs';
const [{ API }, feedAi, { planLibrary, countRequests }] = await Promise.all([imp('modules/feedBackgroundBundle.js'), imp('modules/feedAi.js'), imp('modules/libraryBatch.js')]);
for (const name of ['scoreItems', 'generateFeedTopics', 'translateFeedTopics', 'learnTagNames', 'loadLexicon', 'saveLexicon']) {
 assert(!(name in API) && !(name in feedAi), name + ' is absent from active APIs');
}
const plan = planLibrary({ items: [{ id: 'a', published: 1 }], recaps: {}, source: 'all', inSource: () => true, today: 2, startOfDay: x => x, itemSig: x => x.id, subs: [{ topics: [] }], articleTags: ['Legacy'], rateWithRecap: true });
assert.deepEqual(Object.keys(plan), ['days']);
assert.equal(countRequests(plan, 20), 1);
console.log('TEST 112 OK');
