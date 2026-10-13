// Maximum source text sent for page analysis, shared by settings and the content script.
export const DEFAULT_PAGE_TEXT_LIMIT = 150000;

export function resolvePageTextLimit(value) {
    const limit = Number(value);
    return Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_PAGE_TEXT_LIMIT;
}

export async function loadPageTextLimit() {
    const data = await chrome.storage.sync.get('pageTextLimit');
    return resolvePageTextLimit(data.pageTextLimit);
}

export function limitPageText(text, limit) {
    const source = String(text || '');
    let end = Math.min(source.length, resolvePageTextLimit(limit));
    // Keep surrogate pairs intact when the character limit falls inside an emoji.
    if (end < source.length && /[\uD800-\uDBFF]/u.test(source[end - 1]) && /[\uDC00-\uDFFF]/u.test(source[end])) end--;
    return source.slice(0, end);
}
