// Real Chromium: a restored analysis must visibly paint native highlights in the page.
// NODE_PATH=<Playwright packages> PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<Chromium> node plugin/tests/e2e/restore-highlights.e2e.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const url = 'https://news.ycombinator.com/item?id=50047422';
let sentence = 'An independent argument should be highlighted again when the saved discussion is reopened.';
let html = `<!doctype html><body style="background:#f6f6ef;font:16px Arial;padding:24px"><table id="hnmain"><tr><td><table class="comment-tree"><tr class="comtr"><td><div class="commtext" id="claim">${sentence}</div></td></tr></table></td></tr></table></body>`;
if (process.env.AISH_HN_FIXTURE) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(fs.readFileSync(process.env.AISH_HN_FIXTURE, 'utf8'));
  const claim = [...dom.window.document.querySelectorAll('.commtext')].find(element => element.firstChild?.nodeType === 3 && element.firstChild.textContent.length > 100);
  claim.id = 'claim';
  sentence = claim.firstChild.textContent.trim().split(/(?<=[.!?])\s/)[0];
  html = dom.serialize();
  dom.window.close();
}
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arguments-restore-'));
  let context;
  try {
    const extension = path.resolve(__dirname, '../../dev/aish-extension-chrome');
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      headless: false,
      args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      viewport: { width: 1100, height: 700 }
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await context.route(url, route => route.fulfill({ contentType: 'text/html', body: html }));
    await worker.evaluate(async ({ url, sentence }) => {
      await chrome.storage.local.clear();
      await chrome.storage.sync.set({ aiHighlightingEnabled: true, userHighlightingEnabled: true });
      await chrome.storage.local.set({
        'articles:index': [{ id: 'saved', title: 'Saved discussion', url, timestamp: '2026-10-12T10:00:00Z', summary: '<p>Saved insight.</p>' }],
        'articles:rec:saved': { summary: '<p>Saved insight.</p>', content: '<p>'+sentence+'</p>',
          conversation: [{ id: 'turn', q: 'An earlier question?', a: 'A saved reply.', sources: [], pinned: true }],
          highlights: [{ text: sentence, status: 'matched' }, { text: 'A missing selection must be explained.', status: 'unmatched' }] }
      });
    }, { url, sentence });
    const page = await context.newPage();
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
    await page.goto(url);
    await page.waitForSelector('#aish-hl-host', { state: 'attached' });
    await page.waitForTimeout(2500);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, url);
    const state = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: () => ({
      highlights: [...CSS.highlights.entries()].map(([name, set]) => ({ name, ranges: [...set].map(range => ({ text: range.toString(), collapsed: range.collapsed })) })),
      style: document.getElementById('aish-hl-styles')?.textContent,
      color: getComputedStyle(document.getElementById('claim'), '::highlight(aish-ghost)').backgroundColor
    }) }))[0].result, tabId);
    console.log(JSON.stringify(state));
    assert(state.highlights.some(set => set.name === 'aish-ghost' && set.ranges.some(range => range.text === sentence && !range.collapsed)), 'saved sentences have live native highlight ranges');
    assert.equal(await page.locator('#aish-summary-window').count(), 0, 'restoration uses only the original highlights UI');
    await page.locator('#aish-hl-host .pill').click();
    const labels = await worker.evaluate(() => ({ failure: chrome.i18n.getMessage('highlightMatchFailures', '1'), missing: chrome.i18n.getMessage('highlightNotFound') }));
    await page.locator('#aish-hl-host .pill').filter({ hasText: labels.failure }).waitFor();
    assert.equal(await page.locator('#aish-hl-host [data-match-status="unmatched"] .meta').innerText(), labels.missing);
    const claim = page.locator('#claim');
    const painted = await claim.screenshot();
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => CSS.highlights.clear() }), tabId);
    const bare = await claim.screenshot();
    assert(!painted.equals(bare), 'native highlight ranges visibly change the rendered page');
    await page.reload();
    await page.waitForSelector('#aish-hl-host', { state: 'attached' });
    // The real native opening must preserve the click's user gesture and target this article.
    await worker.evaluate(() => {
      const open = chrome.sidePanel.open;
      chrome.sidePanel.open = options => open(options).then(() => { globalThis.testNativeOpened = true; });
    });
    await page.locator('#aish-hl-host .chat').click();
    await page.waitForTimeout(1000);
    assert(await worker.evaluate(() => globalThis.testNativeOpened), 'Chat opens the native sidebar from the user gesture');
    await worker.evaluate(async tabId => chrome.sidePanel.close({ tabId }), tabId);
    // Exercise the existing iframe sidebar on browsers without a native sidebar.
    await worker.evaluate(() => {
      chrome.sidePanel.open = () => Promise.reject(new Error('Native sidebar unavailable in this test'));
      globalThis.testModelRequests = [];
      chrome.runtime.onMessage.addListener(message => {
        if (['startFetch', 'aiComplete', 'queueSummary'].includes(message.action)) globalThis.testModelRequests.push(message.action);
      });
    });
    await page.locator('#aish-hl-host .chat').click();
    const sidebar = page.frameLocator('#ai-summary-hybrid-sidebar');
    await sidebar.locator('.controls-bar[data-state="followup"]').waitFor();
    assert.equal(await sidebar.locator('.summary-bubble-body').innerText(), 'Saved insight.');
    assert((await sidebar.locator('.ask-thread').innerText()).includes('A saved reply.'));
    await sidebar.locator('.highlights summary').click();
    await sidebar.locator('.highlights [data-match-status="unmatched"]').waitFor();
    await page.evaluate(() => {
      const late = document.createElement('p');
      late.textContent = 'A missing selection must be explained.';
      document.getElementById('hnmain').appendChild(late);
    });
    await sidebar.locator('.highlights [data-match-status="matched"]').filter({ hasText: 'A missing selection must be explained.' }).waitFor();
    assert.equal(await sidebar.locator('.highlights .failure').count(), 0, 'late page matches update Chat failure counts without reopening');
    assert.equal(await worker.evaluate(() => globalThis.testModelRequests.length), 0, 'Chat does not rerun summarization');
    const panelPath = await worker.evaluate(async tabId => (await chrome.sidePanel.getOptions({ tabId })).path, tabId);
    assert(panelPath.includes('chat=saved'), 'the native sidebar receives the saved article too');
    assert(panelPath.includes('pageTab=' + tabId), 'the native sidebar stays bound to the originating tab');
    if (process.env.AISH_SCREENSHOT) await page.screenshot({ path: process.env.AISH_SCREENSHOT, animations: 'disabled' });
    console.log('RESTORED HIGHLIGHTS BROWSER TEST OK');
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
