// Actual page analysis requests honor the configured input cap in cloud/Gemini/PDF and detached completion.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { dom, w, store } = setup({});
const { SK } = await imp('modules/storageKeys.js');
dom.reconfigure({ url: 'https://page.example/article' });
document.title = 'Long article';
const source = 'A useful source sentence. '.repeat(7000);
document.body.innerHTML = '<article><p>' + source + '</p></article>';
globalThis.MutationObserver = w.MutationObserver;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
w.HTMLElement.prototype.animate = () => ({});
chrome.runtime.id = 'abc';
chrome.runtime.getURL = (path) => 'chrome-extension://abc/' + path;
store.connectionMode = 'cloud';
store.aiHighlightingEnabled = false;
store.userHighlightingEnabled = false;
const sent = [];
chrome.runtime.sendMessage = (message, callback) => {
    sent.push(message);
    callback?.({ started: true });
    return Promise.resolve({ success: true });
};
globalThis.fetch = async () => ({ ok: true, json: async () => [] });
await imp('content.js');
const emit = message => globalThis.__msgL.forEach(fn => fn(message, {}, () => {}));
async function request(limit, { gemini = false, attachment = null } = {}) {
    if (limit === undefined) delete store.pageTextLimit;
    else store.pageTextLimit = limit;
    store.connectionMode = gemini ? 'byok' : 'cloud';
    store.activeService = 'gemini';
    store[SK.servicesConfig] = { gemini: { apiKey: 'test', model: 'test', endpoint: 'https://provider.example/chat' } };
    const before = sent.length;
    emit({ action: 'fetchSummary', summaryMode: 'extension', summaryLength: 100, attachment });
    let started;
    for (let i = 0; i < 100 && !started; i++) {
        await tick();
        started = sent.slice(before).find(message => message.action === 'startFetch');
    }
    assert(started, 'page summary starts');
    const body = JSON.parse(started.body);
    const input = gemini ? body.contents[0].parts.find(part => part.text.startsWith('SOURCE PAGE:')).text.slice('SOURCE PAGE:\n'.length)
        : body.messages[1].content.slice('SOURCE PAGE:\n'.length).split('\n\n=== FINAL INSTRUCTIONS ===')[0];
    const expected = (attachment?.text || source.trim()).slice(0, limit || 150000);
    assert.equal(input, expected, 'the request contains exactly the capped source');
    assert.equal(started.detach.highlightSourceText, expected, 'detached highlight matching uses the same capped source');
    assert.equal(started.detach.highlightSourceTruncated, expected.length < (attachment?.text || source.trim()).length);
    assert(sent.slice(before).find(message => message.action === 'summaryContext').shortened, 'context reports shortened source text');
    emit({ action: 'streamChunk', requestId: started.requestId, payload: { stopped: true } });
    await tick();
}
await request(undefined);
await request(90000);
await request(120000, { gemini: true });
await request(1500, { attachment: { name: 'source.pdf', text: source, html: '<p>PDF source</p>' } });
console.log('TEST 146 OK');
w.close();
