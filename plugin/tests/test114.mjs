// Feed preferences: performance profile select applies batch / requests / interval; "Measure this computer" times two rating batches.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const now = Date.now();
const { store, w } = setup({});
store['feeds:subs'] = [{ id: 'a', url: 'https://a.test/feed', title: 'A', tags: [], lastFetched: now }];
store['feeds:items'] = [{ id: 'x1', feedId: 'a', title: 'Post', link: 'https://a.test/1', published: now - 1000, read: false, ai: true, cat: 'Tech' }];
let calls = 0;
globalThis.__ai = (m) => {
    calls++;
    const n = (m.user.match(/^\[\d+\]/gm) || []).length;
    const nums = Array.from({ length: n }, (_, k) => k + 1);
    return { ok: true, text: JSON.stringify({ scores: nums.map(() => 0.1), labels: nums.map(() => 'News') }) };
};
store.connectionMode = 'local'; store.activeService = 'ollama';
const fm = await imp('modules/feedManager.js'); fm.initFeedManager({ showToast() {}, showScreen() {} }); await tick(80);
w.document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feedprefs' } })); await tick(250);
const card = () => w.document.querySelector('#feedPrefsLibrary');
assert(!card().querySelector('#feedSetPreset'), 'retired rating benchmark controls removed');
assert(!/Measure this computer/.test(card().textContent));
assert(card().querySelector('#feedSetLibBatch') && card().querySelector('#feedSetRequests'), 'recap batch and request settings remain');
assert.equal(calls, 0, 'opening settings sends no metadata requests');
console.log('TEST 114 OK');
w.close();
