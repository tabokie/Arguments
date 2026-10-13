// On-page highlights panel: split pill with Chat, footer action, opening state.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
const P = await imp('content/highlightPanel.js');
let calls = 0; let release;
const actions = { jump() {}, remove() {}, keep() {}, reattach() {}, pending: () => false,
  chat: () => { calls++; return new Promise((r) => { release = r; }); } };
const items = [{ id: 'a', type: 'user', text: 'Hello world', status: 'ok', frac: 0.2 }];
P.hlpRender(items, actions);
const host = d.getElementById('aish-highlight-panel') || d.querySelector('[id^="aish-"]');
assert(host, 'panel host exists');
const body = host._body;
assert(body, 'body reachable');
assert(body.querySelector('.split .pill') && body.querySelector('.split .chat'), 'split pill');
assert(body.querySelector('.chat').textContent.includes('Chat'));
body.querySelector('.chat').click(); await tick(10);
assert.equal(calls, 1, 'chat opened');
assert(body.querySelector('.chat').disabled && /Opening/.test(body.querySelector('.chat').textContent), 'busy');
body.querySelector('.chat').click(); assert.equal(calls, 1, 'no double open');
release(); await tick(20);
assert(!body.querySelector('.chat').disabled, 'busy cleared');
body.querySelector('.pill').click(); await tick(5);
assert(body.querySelector('.foot .go'), 'footer action when open');
assert(/Open the extension to chat/.test(body.querySelector('.foot').textContent));
body.querySelector('.go').click(); await tick(10);
assert.equal(calls, 2);
release(); await tick(10);
console.log('test48 ok');
