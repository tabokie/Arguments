// Settings › Prompts: two independently editable instructions, in execution order.
import { T } from './feedI18n.js';
import { escapeHtml as esc } from './textUtils.js';
import { DEFAULT_HIGHLIGHT_PROMPT, DEFAULT_SUMMARY_PROMPT, loadPagePrompts, RETIRED_PROMPT_KEYS } from './pagePrompts.js';
import { DEFAULT_PAGE_TEXT_LIMIT, loadPageTextLimit, resolvePageTextLimit } from './pageInput.js';

let flush = async () => {};
export const savePromptSettings = () => flush();

export async function initPromptSettings(rootEl) {
    const root = rootEl || document.getElementById('promptSettingsRoot');
    if (!root) return;
    const [prompts, pageTextLimit] = await Promise.all([loadPagePrompts(), loadPageTextLimit()]);
    root.innerHTML = `<p class="ps-intro">${esc(T('Customize the instructions used to analyze a page.'))}</p>
      <div class="ps-group">
        <div class="ps-row"><label class="ps-label" for="pageTextLimit">${esc(T('Page text limit (characters)'))}</label>
          <button type="button" class="ps-link" data-reset="pageTextLimit">${esc(T('Reset to default'))}</button></div>
        <input id="pageTextLimit" type="number" min="1" max="${Number.MAX_SAFE_INTEGER}" step="1" value="${pageTextLimit}" aria-describedby="pageTextLimitHint">
        <p class="ps-note" id="pageTextLimitHint">${esc(T('Analyze the first part of longer pages, up to this character limit. Default: 150,000.'))}</p>
      </div>
      <div class="ps-group">
        <div class="ps-row"><label class="ps-label" for="highlightPrompt">${esc(T('Highlight prompt'))}</label>
          <button type="button" class="ps-link" data-reset="highlightPrompt">${esc(T('Reset to default'))}</button></div>
        <textarea id="highlightPrompt" class="ps-text" rows="10" spellcheck="false">${esc(prompts.highlightPrompt)}</textarea>
      </div>
      <div class="ps-group">
        <div class="ps-row"><label class="ps-label" for="prompt">${esc(T('Main output prompt'))}</label>
          <button type="button" class="ps-link" data-reset="prompt">${esc(T('Reset to default'))}</button></div>
        <textarea id="prompt" class="ps-text" rows="7" spellcheck="false">${esc(prompts.summaryPrompt)}</textarea>
      </div>
      <p class="ps-note" id="promptSaveStatus" role="status" aria-live="polite"></p>`;
    const highlight = root.querySelector('#highlightPrompt');
    const summary = root.querySelector('#prompt');
    const status = root.querySelector('#promptSaveStatus');
    const limitInput = root.querySelector('#pageTextLimit');
    let timer;
    let highlightMode = prompts.highlightPromptMode, mainMode = prompts.mainOutputPromptMode;
    flush = async () => {
        clearTimeout(timer);
        try {
            const limitSetting = limitInput.validity.valid ? { pageTextLimit: resolvePageTextLimit(limitInput.value) } : {};
            await chrome.storage.sync.set({ ...limitSetting, highlightPrompt: highlightMode === 'custom' ? highlight.value : '', prompt: mainMode === 'custom' ? summary.value : '', highlightPromptMode: highlightMode, mainOutputPromptMode: mainMode });
            await chrome.storage.sync.remove(RETIRED_PROMPT_KEYS);
            status.textContent = T('Saved');
        } catch (error) {
            status.textContent = T('Could not save prompts.');
            throw error;
        }
    };
    const save = () => flush().catch(() => {});
    root.addEventListener('input', (event) => {
        if (event.target === highlight) highlightMode = highlight.value.trim() ? 'custom' : 'default';
        if (event.target === summary) mainMode = summary.value.trim() ? 'custom' : 'default';
        clearTimeout(timer);
        status.textContent = '';
        timer = setTimeout(save, 400);
    });
    root.addEventListener('change', (event) => {
        if (event.target === limitInput) {
            if (!limitInput.reportValidity()) return;
            limitInput.value = String(resolvePageTextLimit(limitInput.value));
        }
        if (event.target === highlight) highlightMode = highlight.value.trim() ? 'custom' : 'default';
        if (event.target === summary) mainMode = summary.value.trim() ? 'custom' : 'default';
        save();
    });
    root.addEventListener('click', (event) => {
        const button = event.target.closest('[data-reset]');
        if (!button || !root.contains(button)) return;
        if (button.dataset.reset === 'highlightPrompt') { highlight.value = DEFAULT_HIGHLIGHT_PROMPT; highlightMode = 'default'; }
        else if (button.dataset.reset === 'prompt') { summary.value = DEFAULT_SUMMARY_PROMPT; mainMode = 'default'; }
        else if (button.dataset.reset === 'pageTextLimit') limitInput.value = String(DEFAULT_PAGE_TEXT_LIMIT);
        save();
    });
}
