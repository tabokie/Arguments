// One safe, collapsed disclosure for source recovery and page matching results.
export function renderHighlights(highlights, message = (key, count) => chrome.i18n?.getMessage(key, count)) {
  const labels = {
    unmatched: ['highlightNotFound', 'Not found on page'],
    ambiguous: ['highlightAmbiguous', 'Multiple page matches'],
    'source-unmatched': ['highlightSourceNotFound', 'Prefix not found in source'],
    'source-ambiguous': ['highlightSourceAmbiguous', 'Multiple source sentences'],
    'invalid-response': ['highlightInvalidResponse', 'Highlight response could not be read'],
    disabled: ['highlightingDisabled', 'Page highlighting disabled'],
    unavailable: ['highlightingUnavailable', 'Page highlighting unavailable']
  };
  const selections = Array.isArray(highlights) ? highlights.map(selection => typeof selection === 'string' ? { text: selection } : selection)
    .filter(selection => selection && typeof selection.text === 'string' && (selection.text.trim() || selection.status === 'invalid-response')) : [];
  if (!selections.length) return null;
  const labelText = (key, fallback, count) => {
    const translated = message(key, count);
    return (translated && translated !== key ? translated : fallback).replace(/\$COUNT\$|\$1/g, count || '');
  };
  const isFailure = status => ['unmatched', 'ambiguous', 'source-unmatched', 'source-ambiguous', 'invalid-response'].includes(status);
  const details = document.createElement('details');
  details.className = 'highlights';
  const label = document.createElement('summary');
  label.textContent = labelText('f_highlights_fa5c', 'Highlights') + ` (${selections.length})`;
  const failures = selections.filter(selection => isFailure(selection.status)).length;
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
    if (labels[status]) {
      const indicator = document.createElement('span');
      indicator.className = 'match-status' + (isFailure(status) ? ' failure' : '');
      indicator.textContent = labelText(...labels[status]);
      item.appendChild(indicator);
    }
    list.appendChild(item);
  }
  details.append(label, list);
  return details;
}
