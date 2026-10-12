// New prompt defaults replace retired preset/builder selections and preserve custom instructions.
import { setup, imp } from './harness.mjs';
import assert from 'assert';
const prompts = await imp('modules/pagePrompts.js');
async function check(initial, expectedSummary) {
  const { store, w } = setup({}); Object.assign(store, initial);
  const { default: StorageManager } = await imp('modules/storageManager.js');
  await StorageManager.ensurePromptDefaults();
  assert.equal(prompts.resolvePagePrompts(store).summaryPrompt, expectedSummary);
  assert.equal(store.mainOutputPromptMode, expectedSummary === prompts.DEFAULT_SUMMARY_PROMPT ? 'default' : 'custom');
  assert.equal(store.prompt, store.mainOutputPromptMode === 'custom' ? expectedSummary : '');
  assert.equal(prompts.resolvePagePrompts(store).highlightPrompt, initial.highlightPrompt?.trim() ? initial.highlightPrompt : prompts.DEFAULT_HIGHLIGHT_PROMPT);
  assert(!('promptType' in store));
  for (const key of prompts.RETIRED_PROMPT_KEYS) assert(!(key in store), 'obsolete selector removed: ' + key);
  const before = JSON.stringify(store);
  await StorageManager.ensurePromptDefaults();
  assert.equal(JSON.stringify(store), before, 'migration is idempotent');
  w.close();
}
await check({}, prompts.DEFAULT_SUMMARY_PROMPT);
await check({ prompt: 'Old preset', presetPrompt: 'Technical Deep Dive', promptType: 'preset' }, prompts.DEFAULT_SUMMARY_PROMPT);
await check({ prompt: 'Generated builder', presetPrompt: 'builder', promptType: 'builder', promptBuilder: {} }, prompts.DEFAULT_SUMMARY_PROMPT);
await check({ prompt: 'Custom analysis', highlightPrompt: 'Custom highlights', promptType: 'custom', promptCustomText: 'Custom analysis' }, 'Custom analysis');
await check({ prompt: 'Legacy hand-written instruction' }, 'Legacy hand-written instruction');
await check({ prompt: ' \n ', highlightPrompt: '\t', promptType: 'custom' }, prompts.DEFAULT_SUMMARY_PROMPT);
await check({ prompt: '- brief summary\n    - fun standup comedy set on the topic\n    - what does it mean for my profession (ux)\n    - book recommendations', promptType: 'custom' }, prompts.DEFAULT_SUMMARY_PROMPT);
const explicit = prompts.resolvePagePrompts({ prompt: prompts.DEFAULT_SUMMARY_PROMPT, mainOutputPromptMode: 'custom' });
assert.equal(explicit.mainOutputPromptMode, 'custom', 'explicit custom mode is never inferred from matching text');
const dynamic = prompts.resolvePagePrompts({ prompt: 'stale bundled default', mainOutputPromptMode: 'default' });
assert.equal(dynamic.summaryPrompt, prompts.DEFAULT_SUMMARY_PROMPT, 'default mode always resolves the current bundled instructions');
assert.equal(prompts.buildPageInstructions({ summaryPrompt: 'Briefly surface valuable content that the highlights may miss.' }).includes('Briefly surface'), true, 'request assembly preserves supplied custom text');
console.log('TEST 34 OK');
