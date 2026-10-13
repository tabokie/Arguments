// One safe, collapsed disclosure for source recovery and page matching results.
const HIGHLIGHT_STATUS_LABELS = {
    unmatched: ['highlightNotFound', 'Not found on page'],
    ambiguous: ['highlightAmbiguous', 'Multiple page matches'],
    'source-unmatched': ['highlightSourceNotFound', 'Prefix not found in source'],
    'source-ambiguous': ['highlightSourceAmbiguous', 'Multiple source sentences'],
    'invalid-response': ['highlightInvalidResponse', 'Highlight response could not be read'],
    disabled: ['highlightingDisabled', 'Page highlighting disabled'],
    unavailable: ['highlightingUnavailable', 'Page highlighting unavailable']
};
export function isHighlightMatchFailure(status) {
  return ['unmatched', 'ambiguous', 'source-unmatched', 'source-ambiguous', 'invalid-response'].includes(status);
}
export function highlightStatusLabel(status, message = (key, count) => chrome.i18n?.getMessage(key, count)) {
  const label = HIGHLIGHT_STATUS_LABELS[status];
  if (!label) return '';
  const translated = message(label[0]);
  return translated && translated !== label[0] ? translated : label[1];
}
export function renderHighlights(highlights, message = (key, count) => chrome.i18n?.getMessage(key, count)) {
  const selections = Array.isArray(highlights) ? highlights.map(selection => typeof selection === 'string' ? { text: selection } : selection)
    .filter(selection => selection && typeof selection.text === 'string' && (selection.text.trim() || selection.status === 'invalid-response')) : [];
  if (!selections.length) return null;
  const labelText = (key, fallback, count) => {
    const translated = message(key, count);
    return (translated && translated !== key ? translated : fallback).replace(/\$COUNT\$|\$1/g, count || '');
  };
  const details = document.createElement('details');
  details.className = 'highlights';
  const label = document.createElement('summary');
  label.textContent = labelText('f_highlights_fa5c', 'Highlights') + ` (${selections.length})`;
  const failures = selections.filter(selection => isHighlightMatchFailure(selection.status)).length;
  if (failures) {
    const count = document.createElement('span');
    count.className = 'match-status failure';
    count.textContent = labelText('highlightMatchFailures', `${failures} not matched`, String(failures));
    label.appendChild(count);
  }
  const list = document.createElement('ul');
  for (const { text, status } of selections) {
    const item = document.createElement('li');
    if (status) item.dataset.matchStatus = status;
    const sentence = document.createElement('span');
    sentence.className = 'highlight-sentence';
    sentence.textContent = text;
    item.appendChild(sentence);
    if (HIGHLIGHT_STATUS_LABELS[status]) {
      const indicator = document.createElement('span');
      indicator.className = 'match-status' + (isHighlightMatchFailure(status) ? ' failure' : '');
      indicator.textContent = highlightStatusLabel(status, message);
      item.appendChild(indicator);
    }
    list.appendChild(item);
  }
  details.append(label, list);
  return details;
}
