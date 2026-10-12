// Research phase 2: SCHOLARLY comment merge, Research tab + type filters, DOI/author search, key facts.
import assert from 'assert';
import fs from 'fs';
import { setup, imp } from './harness.mjs';
const { w } = setup({}); const d = w.document;
const { applyScholarly, paperIndexFields } = await imp('content/paper.js');
// AI-only detection (PDF / site without metadata)
let p = applyScholarly(null, '{"scholarly":true,"type":"Randomized controlled trial","design":"RCT","sample":"n=120","limitations":"short follow-up"}');
assert.equal(p.state, 'likely'); assert.equal(p.type, 'trial'); assert.equal(p.facts.sample, 'n=120');
assert.deepEqual(paperIndexFields(p), { paper: 'likely', paperType: 'trial' });
// page said "likely" + model confirms → yes; model denies → dropped; strong page signal survives a denial
assert.equal(applyScholarly({ state: 'likely', doi: '10.1234/abc' }, { scholarly: true, type: 'study' }).state, 'yes');
assert.equal(applyScholarly({ state: 'likely' }, '{"scholarly":false}'), null);
assert.equal(applyScholarly({ state: 'yes', doi: '10.1234/abc' }, '{"scholarly":false}').state, 'yes');
assert.equal(applyScholarly(null, '{"scholarly":false}'), null);
assert.deepEqual(applyScholarly({ state: 'yes' }, 'garbage'), { state: 'yes' });   // unparsable keeps page signals
assert.equal(applyScholarly(null, '{"scholarly":true,"type":"systematic review"}').type, 'review');
// Completion merges scholarly metadata without exposing the metadata in the response.
const { finalizeSummary } = await imp('content/finalize.js');
const finished = await finalizeSummary({ raw: '<div><p>A trial finding.</p></div><!-- SCHOLARLY: {"scholarly":true,"type":"trial","sample":"n=120"} -->', selectedLanguage: 'en', contentText: 'We ran a trial of 120 people.', pageTitle: 'Trial', pageMeta: {} });
assert(!finished.pageMeta.paper, 'completion ignores retired scholarly metadata');
assert(!finished.cleanHtml.includes('SCHOLARLY'));
const am = fs.readFileSync(new URL('../src/modules/articleManager.js', import.meta.url), 'utf8');
assert(!/RESEARCH_FILTERS|paper-facts-btn|renderPaperRow|renderDetailTags/.test(am), 'research controls removed');
console.log('TEST 64 OK');
w.close();
