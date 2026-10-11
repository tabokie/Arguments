// Settings opens the browser shortcut editor from the home row and search, including Firefox's native API.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({});
const opened = [], errors = [];
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { create: async (options) => { opened.push(options.url); } };
const { initSettingsNav } = await imp('modules/settingsNav.js');
initSettingsNav({ showToast: (message) => errors.push(message) });
const row = document.getElementById('browserShortcutsButton');
assert(row && !row.hidden, 'shortcut entry is visible in Chromium settings');
row.click(); await tick();
assert.deepEqual(opened, ['chrome://extensions/shortcuts']);
const search = document.getElementById('settingsSearch');
search.value = 'keyboard shortcuts';
search.dispatchEvent(new w.Event('input'));
const hit = document.querySelector('#settingsSearchResults .settings-result');
assert(hit, 'shortcut settings are searchable');
hit.click(); await tick();
assert.equal(opened.length, 2, 'search opens the editor directly');

const shortcuts = await imp('modules/browserShortcuts.js');
Object.defineProperty(w.navigator, 'userAgent', { value: 'Mozilla/5.0 Chrome/140.0 Edg/140.0', configurable: true });
await shortcuts.openBrowserShortcuts();
assert.equal(opened.at(-1), 'edge://extensions/shortcuts');

let firefoxOpened = 0;
globalThis.browser = { commands: { async openShortcutSettings() { firefoxOpened++; } } };
await shortcuts.openBrowserShortcuts();
assert.equal(firefoxOpened, 1, 'Firefox uses its shortcut editor API');
assert.equal(opened.length, 3, 'Firefox does not open a Chromium URL');
delete globalThis.browser;
chrome.tabs.create = async () => { throw new Error('Unavailable'); };
row.click(); await tick();
assert.equal(errors.length, 1, 'an opening failure is visible to the reader');
chrome.runtime.getURL = (p) => 'safari-web-extension://abc/' + p;
assert(!shortcuts.canOpenBrowserShortcuts(), 'unsupported browsers do not receive a Chromium URL');
console.log('TEST 128 OK');
w.close();
