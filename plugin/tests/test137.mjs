// Retired tags cannot affect archive matching or similarity.
import assert from 'assert';
import { imp } from './harness.mjs';
const { buildIndex, search, similarTo } = await imp('modules/localSearch.js');
const articles = [{ timestamp: 1, title: 'City buses', summary: 'Transit investments', tags: ['quasar'] }, { timestamp: 2, title: 'Distant stars', summary: 'Astronomy research', tags: ['quasar'] }];
const index = buildIndex(articles);
assert.deepEqual(search(index, articles, 'quasar'), [], 'legacy tags must not match either search tier');
assert.deepEqual(search(index, articles, 'transit'), [articles[0]], 'main output remains searchable');
assert.deepEqual(similarTo(index, articles, articles[0]), [], 'tags cannot create artificial similarity');
console.log('TEST 137 OK');
