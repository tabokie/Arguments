// Completed results use the existing on-page highlights control and remain saved for Chat.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { dom, w, store } = setup({});
const { DEFAULT_HIGHLIGHT_PROMPT, DEFAULT_SUMMARY_PROMPT } = await imp('modules/pagePrompts.js');
const { SK } = await imp('modules/storageKeys.js');
dom.reconfigure({ url: 'https://page.example/article' });
document.documentElement.lang = 'en';
document.title = 'Page title';
document.body.innerHTML = '<article><p>A source argument about <strong>technology</strong> and research.</p><p id="missing-source">An unmatched source argument remains useful when the webpage changes.</p><script>A source argument that is only script noise.</script></article>';
globalThis.MutationObserver = w.MutationObserver;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
w.HTMLElement.prototype.animate = () => ({});
chrome.runtime.id = 'abc';
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.i18n = { detectLanguage: (_text, cb) => cb({ languages: [{ language: 'en', percentage: 100 }] }), getMessage: () => '' };
store.connectionMode = 'cloud';
store.aiHighlightingEnabled = true;
store.userHighlightingEnabled = false;
const relayed = [];
let requestId;
chrome.runtime.sendMessage = (message, callback) => {
  relayed.push(message);
  if (message.action === 'startFetch') requestId = message.requestId;
  callback?.({ started: true });
  return Promise.resolve({ success: true });
};
await imp('content.js');
const emit = (message) => globalThis.__msgL.forEach(fn => fn(message, {}, () => {}));
emit({ action: 'fetchSummary', summaryMode: 'extension', selectedLanguage: 'en', summaryLength: 100 });
for (let i = 0; i < 50 && !requestId; i++) await tick();
assert(requestId, 'summary request starts');
const defaultBody = JSON.parse(relayed.find(message => message.action === 'startFetch').body);
for (const message of defaultBody.messages) {
  assert(message.content.indexOf(DEFAULT_HIGHLIGHT_PROMPT) < message.content.indexOf(DEFAULT_SUMMARY_PROMPT));
  assert(message.content.includes(DEFAULT_HIGHLIGHT_PROMPT) && message.content.includes(DEFAULT_SUMMARY_PROMPT));
  assert(!/(?:TAGS|MOOD|QUESTIONS|SCHOLARLY):/.test(message.content), 'retired metadata instructions are absent');
}
assert(defaultBody.messages.at(-1).content.endsWith(defaultBody.messages[0].content), 'the final reminder repeats the complete assembled prompt after the source');
assert(!document.getElementById('aish-summary-window'), 'no window while the model is writing');
const raw = '<h2>Research</h2><p>A completed finding.</p><!-- TAGS: Technology, Research --><!-- GHOST_HIGHLIGHTS: ["A source argument"] -->';
emit({ action: 'streamChunk', requestId, payload: { chunk: 'data: ' + JSON.stringify({ choices: [{ delta: { content: raw } }] }) + '\n' } });
assert(!document.getElementById('aish-summary-window'), 'streamed text does not open a partial window');
emit({ action: 'streamChunk', requestId, payload: { done: true } });
for (let i = 0; i < 50 && !store['articles:index']?.length; i++) await tick();
for (let i = 0; i < 50 && !document.getElementById('aish-hl-host'); i++) await tick();
const host = document.getElementById('aish-hl-host');
assert(host, 'the existing highlights control appears after completion');
assert(!document.getElementById('aish-summary-window'), 'completion creates no redundant window');
assert(host.shadowRoot.querySelector('.chat').textContent.includes('Chat'));
host.shadowRoot.querySelector('.pill').click();
assert.equal(host.shadowRoot.querySelector('.item .q').textContent, '“A source argument about technology and research.”');
assert.equal(host.shadowRoot.querySelector('.item').dataset.matchStatus, 'matched');
assert(!host.shadowRoot.querySelector('.failure'), 'successful matching does not show a warning');
assert(relayed.some(message => message.action === 'summaryComplete'), 'completion still reaches extension views');
assert(store['articles:index']?.length, 'summary remains saved in history');
const complete = relayed.find(message => message.action === 'summaryComplete');
assert.equal(complete.highlights[0].status, 'matched', 'matching results reach the extension panel');
assert.deepEqual(store['articles:rec:' + store['articles:index'][0].id].highlights, complete.highlights, 'live completion persists the same highlights');
assert(!document.querySelector('.placeholder'), 'the loading placeholder is removed');
assert.deepEqual(store[SK.annotations].filter(annotation => annotation.type === 'ghost').map(annotation => annotation.text), ['A source argument about technology and research.'], 'model prefixes become full-sentence annotations');
assert.equal([...document.querySelectorAll('article .ai-ghost-highlight')].map(mark => mark.textContent).join(''), 'A source argument about technology and research.', 'the complete webpage sentence is marked across inline elements');
const detached = relayed.find(message => message.action === 'startFetch').detach;
assert.deepEqual(store['articles:rec:' + store['articles:index'][0].id].analysisSource, { text: detached.highlightSourceText, truncated: detached.highlightSourceTruncated }, 'live completion persists the exact analyzed source');
assert(defaultBody.messages[1].content.startsWith('SOURCE PAGE:\n' + detached.highlightSourceText + '\n\n'), 'detached completion retains the exact sanitized source sent to the model');
// Verify the actual requests, including Gemini's distinct API format and queued prompt overrides.
globalThis.fetch = async (url) => {
  assert.equal(url, 'chrome-extension://abc/services.json', 'provider requests stay inside the streaming mock');
  return { ok: true, json: async () => [] };
};
store.connectionMode = 'byok';
store[SK.servicesConfig] = Object.fromEntries(['openai', 'gemini', 'ollama'].map(service => [service, {
  apiKey: 'test-key', model: 'test-model', endpoint: service === 'ollama' ? 'http://localhost:11434/api/chat' : 'https://provider.example/chat'
}]));
for (const service of ['openai', 'gemini', 'ollama']) {
  store.activeService = service;
  store.highlightPrompt = `Select ${service} recommendations.`;
  store.prompt = `Explain ${service} implications.`;
  const overrides = service === 'gemini' ? { highlightPrompt: 'Queued highlight instructions.', prompt: 'Queued summary instructions.' } : {};
  const expectedHighlight = overrides.highlightPrompt || store.highlightPrompt;
  const expectedSummary = overrides.prompt || store.prompt;
  requestId = null;
  const completed = relayed.filter(message => message.action === 'summaryComplete').length;
  emit({ action: 'fetchSummary', summaryMode: 'extension', selectedLanguage: 'en', summaryLength: 100, ...overrides });
  for (let i = 0; i < 50 && !requestId; i++) await tick();
  assert(requestId, `${service} request starts`);
  const request = relayed.findLast(message => message.action === 'startFetch');
  const body = JSON.parse(request.body);
  const instructions = service === 'gemini' ? body.contents[0].parts.filter(part => !part.text.startsWith('SOURCE PAGE:')).map(part => part.text) : body.messages.map(message => message.content);
  for (const text of instructions) {
    assert(text.includes(expectedHighlight) && text.includes(expectedSummary), `${service} receives both configured prompts`);
    assert(text.indexOf(expectedHighlight) < text.indexOf(expectedSummary), `${service} highlights precede summary instructions`);
    assert(!text.includes(DEFAULT_HIGHLIGHT_PROMPT) && !text.includes(DEFAULT_SUMMARY_PROMPT), `${service} custom prompts replace defaults`);
    assert(!/(?:TAGS|MOOD|QUESTIONS|SCHOLARLY):/.test(text), `${service} omits retired metadata instructions`);
  }
  if (service === 'gemini') assert(body.contents[0].parts.at(-1).text.endsWith(body.contents[0].parts[0].text), 'Gemini receives the final reminder after the source');
  else assert(body.messages.at(-1).content.endsWith(body.messages[0].content), `${service} receives the final reminder after the source`);
  const output = service === 'openai' ? raw.replace('["A source argument"]', '["An unmatched source argument"]') : raw;
  const payload = service === 'gemini' ? { candidates: [{ content: { parts: [{ text: output }] } }] } : service === 'ollama' ? { message: { content: output } } : { choices: [{ delta: { content: output } }] };
  emit({ action: 'streamChunk', requestId, payload: { chunk: (service === 'ollama' ? '' : 'data: ') + JSON.stringify(payload) + '\n' } });
  if (service === 'openai') document.getElementById('missing-source').remove();
  emit({ action: 'streamChunk', requestId, payload: { done: true } });
  for (let i = 0; i < 50 && relayed.filter(message => message.action === 'summaryComplete').length === completed; i++) await tick();
  assert.equal(relayed.filter(message => message.action === 'summaryComplete').length, completed + 1, `${service} completion still works`);
  if (service === 'openai') {
    let fallback;
    for (let i = 0; i < 50 && !fallback; i++) {
      fallback = document.getElementById('aish-hl-host').shadowRoot.querySelector('[data-match-status="unmatched"]');
      if (!fallback) await tick();
    }
    assert(fallback, 'unmatched sentences remain in the original highlights panel');
    assert.equal(fallback.querySelector('.q').textContent, '“An unmatched source argument remains useful when the webpage changes.”');
    assert.equal(fallback.querySelector('.meta').textContent, 'Not found on page');
    assert(document.getElementById('aish-hl-host').shadowRoot.querySelector('.pill').textContent.includes('1 not matched'));
    assert(!store[SK.annotations].some(annotation => annotation.text.startsWith('An unmatched source argument')), 'the fallback does not require a successful webpage annotation');
    const completion = relayed.findLast(message => message.action === 'summaryComplete');
    const saved = store['articles:rec:' + store['articles:index'].at(-1).id];
    assert.deepEqual(saved.highlights, completion.highlights, 'unmatched complete sentences and failure states survive saving');
  }
}
// A local model reads a large page in parts; the final prefixes still resolve to the original sanitized source.
const chunkedSentence = 'Chunked argument preserves every qualification from the original page.';
const collisions = ['We should adopt congestion pricing in cities.', 'We should adopt shorter workweeks in factories.'];
document.body.innerHTML = '<article><p>' + collisions[0] + '</p><p>' + 'Background details are supporting material, rather than independent arguments. '.repeat(120) + '</p><p>' + collisions[1] + '</p><p>' + chunkedSentence + '</p></article>';
const captureMessage = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = (message, callback) => {
  const result = captureMessage(message, callback);
  if (message.action === 'startFetch') {
    const body = JSON.parse(message.body);
    let raw;
    if (message.apiUrl.endsWith('/api/show')) raw = JSON.stringify({ model_info: { 'test.context_length': 4096 } });
    else if (body.stream === false) {
      assert(body.messages[0].content.includes('exact prefix'), 'part requests select prefixes');
      assert(body.messages[0].content.includes('Use the shortest unique prefix'), 'part requests require compact selections too');
      assert(!body.messages[0].content.includes(store.prompt), 'final user inclusion criteria are not applied to individual parts');
      assert(body.messages[0].content.includes('even when they are not exceptional on their own'), 'part notes preserve material for cross-part synthesis');
      const source = body.messages[1].content;
      const highlights = [];
      if (collisions.some(sentence => source.includes(sentence))) highlights.push('We should adopt');
      if (source.includes(chunkedSentence)) highlights.push('Chunked argument');
      raw = JSON.stringify({ message: { content: JSON.stringify({ highlights, notes: 'A generated observation. '.repeat(2000) }) } });
    }
    if (raw) setTimeout(() => {
      emit({ action: 'streamChunk', requestId: message.requestId, payload: { chunk: raw } });
      emit({ action: 'streamChunk', requestId: message.requestId, payload: { done: true } });
    }, 0);
  }
  return result;
};
const previousRequests = relayed.length;
emit({ action: 'fetchSummary', summaryMode: 'extension', selectedLanguage: 'en', summaryLength: 100 });
let chunkedRequest;
for (let i = 0; i < 100 && !chunkedRequest; i++) {
  chunkedRequest = relayed.slice(previousRequests).find(message => message.action === 'startFetch' && JSON.parse(message.body).stream === true);
  if (!chunkedRequest) await tick();
}
assert(chunkedRequest, 'chunked final request starts');
const chunkedBody = JSON.parse(chunkedRequest.body);
assert(chunkedBody.messages[0].content.includes('source is represented by reading notes'), 'the final model receives discovery notes while recovered selections remain separate');
assert(!chunkedBody.messages[0].content.includes('GHOST_HIGHLIGHTS'), 'the final model does not reselect arguments from generated notes');
assert(!chunkedBody.messages[1].content.includes('We should adopt'), 'selected prefixes do not compete with discovery notes for the final context');
assert(chunkedBody.messages[1].content.length + chunkedBody.messages[0].content.length < 4096 * 3, 'combined discovery notes fit the model context');
assert.deepEqual(chunkedRequest.detach.highlights.filter(h => h.prefix === 'We should adopt').map(h => h.text), collisions, 'chunk-local prefixes are recovered before global ambiguity can discard them');
assert(chunkedRequest.detach.highlightSourceText.includes(chunkedSentence), 'the resolver retains the full original source, rather than generated notes');
const completedBeforeChunked = relayed.filter(message => message.action === 'summaryComplete').length;
const chunkedOutput = ''; // valid empty main output still paints prepared highlights
emit({ action: 'streamChunk', requestId: chunkedRequest.requestId, payload: { chunk: JSON.stringify({ message: { content: chunkedOutput } }) + '\n' } });
emit({ action: 'streamChunk', requestId: chunkedRequest.requestId, payload: { done: true } });
for (let i = 0; i < 50 && relayed.filter(message => message.action === 'summaryComplete').length === completedBeforeChunked; i++) await tick();
for (const sentence of [...collisions, chunkedSentence]) assert(store[SK.annotations].some(annotation => annotation.text === sentence), 'all chunk selections survive even when the final response has no highlights: ' + sentence);
console.log('TEST 129 OK');
w.close();
process.exit(0);
