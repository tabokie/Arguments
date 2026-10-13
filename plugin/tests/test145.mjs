// Page input settings persist positive integer limits, reject invalid drafts, and reset independently.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store, w } = setup({});
const { DEFAULT_PAGE_TEXT_LIMIT, resolvePageTextLimit, limitPageText, loadPageTextLimit } = await imp('modules/pageInput.js');
assert.equal(DEFAULT_PAGE_TEXT_LIMIT, 150000);
for (const value of [undefined, null, '', 0, -1, 1.5, Infinity, 'bad', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(resolvePageTextLimit(value), 150000, 'invalid limits use the default');
}
assert.equal(limitPageText('x'.repeat(150001)), 'x'.repeat(150000));
assert.equal(limitPageText('A😀B', 2), 'A', 'the limit never splits a surrogate pair');
assert.equal(limitPageText('A😀B', 3), 'A😀');
assert.equal(limitPageText('中文文本', 3), '中文文');
assert.equal(limitPageText('Short page.', 150000), 'Short page.');
const { buildPrompt } = await imp('modules/conversation.js');
const chatInput = limit => buildPrompt({ content: 'X'.repeat(160000), question: 'Why?', pageTextLimit: limit }).user.split('PAGE TEXT:\n')[1].split('\n\nMAIN OUTPUT:')[0];
assert.equal(chatInput(undefined).length, 150000, 'Chat uses the shared default');
assert.equal(chatInput(1000).length, 1000, 'Chat respects a smaller custom limit');
assert.equal(chatInput(120000).length, 120000, 'Chat respects a larger custom limit');
const { initPromptSettings, savePromptSettings } = await imp('modules/promptSettings.js');
const root = document.getElementById('promptSettingsRoot');
await initPromptSettings(root);
const limit = root.querySelector('#pageTextLimit');
assert.equal(limit.value, '150000');
limit.value = '240000';
limit.dispatchEvent(new w.Event('change', { bubbles: true }));
await savePromptSettings();
assert.equal(await loadPageTextLimit(), 240000);
const reloaded = document.createElement('div');
await initPromptSettings(reloaded);
const savedLimit = reloaded.querySelector('#pageTextLimit');
assert.equal(savedLimit.value, '240000', 'the custom limit survives reopening settings');
for (const invalid of ['0', '-12', '1.5']) {
    savedLimit.value = invalid;
    await savePromptSettings();
    assert.equal(store.pageTextLimit, 240000, 'invalid drafts do not replace a valid saved limit');
}
savedLimit.value = '';
savedLimit.dispatchEvent(new w.Event('change', { bubbles: true }));
await savePromptSettings();
assert.equal(savedLimit.value, '150000', 'clearing the limit restores the default');
savedLimit.value = '90000';
reloaded.querySelector('#prompt').value = 'Custom insights.';
reloaded.querySelector('#prompt').dispatchEvent(new w.Event('input', { bubbles: true }));
await savePromptSettings();
reloaded.querySelector('[data-reset="pageTextLimit"]').click();
await savePromptSettings();
assert.equal(store.pageTextLimit, 150000);
assert.equal(store.prompt, 'Custom insights.', 'resetting the limit preserves custom instructions');
console.log('TEST 145 OK');
w.close();
