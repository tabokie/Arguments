// Feeds: first-run empty state, adding feeds through the sheet, grouping items by day.
import { setup, imp, tick } from './harness.mjs';
import assert from 'assert';
const now = Date.now();
// Anchored to the local day so the Today/Yesterday groups hold at any time of day (e.g. just after midnight).
const sod = new Date(now).setHours(0, 0, 0, 0);
const today = (ago) => Math.max(sod + 60e3, now - ago);   // earlier today, never before midnight
const rfc = (ms) => new Date(ms).toUTCString();
const A = `<?xml version="1.0"?><rss version="2.0"><channel><title>Alpha Blog</title><link>https://alpha.example</link>
<item><title>Team wins award for great launch</title><link>https://alpha.example/1</link><pubDate>${rfc(today(3600e3))}</pubDate><description>Success all round</description></item>
<item><title>Notes on boring infrastructure</title><link>https://alpha.example/2</link><pubDate>${rfc(sod-2*3600e3)}</pubDate><description>A tour of postmortems</description></item>
<item><title>Ancient post</title><link>https://alpha.example/3</link><pubDate>${rfc(now-10*86400e3)}</pubDate><description>Old</description></item></channel></rss>`;
const B = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Beta News</title><link rel="alternate" href="https://beta.example"/>
<entry><id>b1</id><title>Attack kills dozens in crisis</title><link rel="alternate" href="https://beta.example/1"/><published>${new Date(today(2*3600e3)).toISOString()}</published><summary>Tragic disaster</summary></entry>
<entry><id>b2</id><title>Quarterly roundup</title><link rel="alternate" href="https://beta.example/2"/><published>${new Date(today(5*3600e3)).toISOString()}</published><summary>Neutral things</summary></entry></feed>`;
const fx = { 'https://alpha.example/feed.xml': A, 'https://beta.example/atom.xml': B };
const { store, sent, w } = setup(fx);
const $ = (s) => w.document.querySelector(s), $$ = (s) => [...w.document.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const shown = []; const uiStub = { showToast: (m) => shown.push(m), showScreen: (n) => shown.push('screen:' + n) };
const fm = await imp('modules/feedManager.js');
fm.initFeedManager(uiStub);
await tick(50);
await fm.onFeedsScreenShown(uiStub);
// 1 first run
assert.equal($('#feedControls').hidden, true, 'controls hidden on first run');
assert.ok($('#feedEmpty').textContent.includes('Follow the sites you read'), 'first-run shown');
// 2 add feeds through the sheet
for (const u of ['https://alpha.example/feed.xml', 'https://beta.example/atom.xml']) {
  click($('#feedAddBtn')); await tick();
  assert.equal($('#feedSheetLayer').hidden, false, 'add sheet opens');
  const input = $('#feedSheetBody input[type=text]'); input.value = u;
  click($('#feedSheetBody [data-feed-add]')); await tick(80);
  assert.equal($('#feedSheetLayer').hidden, true, 'sheet closes after add');
}
assert.equal(store['feeds:subs'].length, 2);
assert.equal($('#feedControls').hidden, false);
console.log('chips:', $$('#feedChipRow .pill').map(b => b.textContent).join(' | '));
assert.ok($('#feedChipRow [data-status=unread]').textContent.startsWith('Unread · 5'), 'unread 5');
// 3 day groups
const heads = $$('.feed-day-label').map(x => x.textContent);
console.log('day groups:', heads);
assert.ok(heads[0].includes('Today'));
assert.ok(heads.some(h => h.includes('Yesterday')));
// 4 retention: 10-day item present (keep 30)
assert.equal(store['feeds:items'].length, 5, 'all 5 items kept');
console.log('items stored', store['feeds:items'].length, 'unscored:', store['feeds:items'].every(i => i.sent === undefined && !i.ai));
assert.ok(store['feeds:items'].every(i => i.sent === undefined), 'no local scoring');
// Removed metadata controls stay absent; feed names remain editable.
document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feeds' } }));
await tick(50);
assert.equal($$('#feedSettingsRoot .feed-tag-input').length, 0);
assert.equal($$('#feedSettingsRoot input[aria-label="Feed name"]').length, 2);
assert(!$('#feedSetMood') && !$('#feedSetRate') && !$('#feedMoodChip'));
click($('#feedFilterChip')); await tick();
assert(!/Any mood|Most positive first/.test($('#feedSheetBody').textContent));
click($('.feed-sheet-done')); await tick();
// Status filtering remains available after the metadata controls are removed.
click($('#feedChipRow [data-status=fav]')); await tick();
assert.equal($$('.feed-item').length, 0, 'no favorites yet');
assert($('#feedEmpty').textContent.includes('Nothing matches'));
click($('#feedChipRow [data-status=all]')); await tick();
assert.equal($$('.feed-item').length, 5, 'All restores the complete feed list');
console.log('PART 1 OK');
globalThis.__ctx = { store, sent, w, fm, uiStub, shown };
