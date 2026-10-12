// Settings → "Name tags in your language": names unknown tags and translates known ones for the current UI language.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
import fs from 'fs'; import path from 'path'; import { SRC } from './harness.mjs';
const { store, w } = setup({});
chrome.runtime.getURL = (p) => p;
globalThis.fetch = async (u) => { const f = path.join(SRC, String(u)); return fs.existsSync(f) ? { ok: true, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')), text: async () => fs.readFileSync(f, 'utf8') } : { ok: false, json: async () => ({}) }; };
const calls = [];
globalThis.__ai = (m) => {
  calls.push(m);
  if (/Translate these topic names/.test(m.system)) return { ok: true, text: m.user.split(',').map(() => 'Fútbol').join(', ') };
  return { ok: true, text: '1:Football = Fútbol' };
};
store.uiLanguage = 'es';
const art = (id, tags) => ({ id, title: id, url: 'https://x/' + id, tags, timestamp: Date.now() });
store['articles:index'] = [art('a', ['Fußball', 'Wetter']), art('b', ['Fußball', 'Wetter']), art('c', ['Wetter'])];
const sm = await imp('modules/settingsManager.js');
await sm.initSettingsManager({ showToast() {}, showScreen() {} });
await tick(50);
assert(!w.document.getElementById('nameTagsButton') && !w.document.getElementById('cleanupTagsButton'));
assert.equal(calls.length, 0);
assert.deepEqual(store['articles:index'].map(article => article.tags), [['Fußball', 'Wetter'], ['Fußball', 'Wetter'], ['Wetter']], 'legacy tags remain stored');
console.log('TEST 116 OK');
w.close();
