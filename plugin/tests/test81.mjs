// Follow-up answers discard retired suggestions, retain verified source quotes, and support continuation and cancellable typing.
import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const imp = (f) => import(pathToFileURL(path.join(SRC, f)).href);
const { parseAnswer, buildPrompt, joinContinuation } = await imp('modules/conversation.js');
const { typeText, typingDelay } = await imp('modules/typewriter.js');

// parseAnswer: answer text, sources and suggestions with short answers
const raw = 'Because of the code.\nSOURCES: "The challenge was never the design; it was the code"\nQUESTIONS: [{"q":"Who paid for it?","a":"The city did. It was funded in 2019."}]';
const pa = parseAnswer(raw, 'The challenge was never the design; it was the code and more.');
assert.equal(pa.a, 'Because of the code.'); assert(!('questions' in pa) && !('quick' in pa), 'legacy suggestions are discarded');
assert.equal(pa.sources.length, 1);

// the full-answer prompt knows the short answer that is already on screen
const p = buildPrompt({ title: 'T', content: '<p>x</p>', summary: '<p>s</p>', turns: [], question: 'Who paid for it?', draft: 'The city did.' });
assert(/ALREADY SEES[\s\S]*The city did\./.test(p.user)); assert(!/ALREADY SEES/.test(buildPrompt({ content: '', summary: '', question: 'q' }).user));
assert(!/QUESTIONS:/.test(p.system), 'follow-up replies do not request automatic suggestions');

// typewriter: uneven delays, longer after sentences, deterministic with a fixed rnd
assert(typingDelay('.', () => 0.5) > typingDelay('a', () => 0.5) + 150, 'pause after a sentence');
const ds = new Set(Array.from({ length: 40 }, () => Math.round(typingDelay('a'))));
assert(ds.size > 8, 'key timing varies');
const timers = []; let now = 0; const log = [];
const t1 = typeText('Hi there. Ok', (s) => log.push(s), { rnd: () => 0.5, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
let guard = 0; while (timers.length && guard++ < 100) { const { fn } = timers.shift(); fn(); }
assert.equal(log[log.length - 1], 'Hi there. Ok'); assert(log.length >= 12 && log[0] === 'H', 'typed char by char');
assert.equal(await t1.done, true);
// fast mode jumps 4 chars at a time
const log2 = []; const q2 = []; const t2 = typeText('abcdefgh', (s) => log2.push(s), { fast: () => true, rnd: () => 0, setTimer: (fn) => { q2.push(fn); return 1; }, clearTimer: () => {} });
guard = 0; while (q2.length && guard++ < 10) q2.shift()();
assert.deepEqual(log2, ['abcd', 'abcdefgh']);
// stop() ends it without finishing; instant shows everything at once
const q3 = []; const t3 = typeText('abc', () => {}, { setTimer: (fn) => { q3.push(fn); return 1; }, clearTimer: () => {} }); t3.stop(); assert.equal(await t3.done, false);
const log4 = []; const t4 = typeText('abc', (s) => log4.push(s), { instant: true }); assert.deepEqual(log4, ['abc']); assert.equal(await t4.done, true);
// continuation: appended to the short answer; a model that starts over is tolerated; lists go on their own paragraph
const H = 'The city paid for it. It was funded in 2019.';
assert.equal(joinContinuation(H, 'More detail follows here.'), H + ' More detail follows here.');
assert.equal(joinContinuation(H, H + ' Then more detail.'), H + ' Then more detail.', 'repeated start is cut');
assert.equal(joinContinuation(H, H), H); assert.equal(joinContinuation('', 'Only the model.'), 'Only the model.'); assert.equal(joinContinuation(H, ''), H);
assert.equal(joinContinuation(H, '- first\n- second'), H + '\n\n- first\n- second');
assert(/Continue directly after it/.test(p.user), 'prompt tells the model to continue');
console.log('TEST 81 OK');
