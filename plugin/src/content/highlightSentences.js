// Expand model-selected prefixes against the source text before matching any webpage DOM.
const highlightNormalize = (text) => text.replace(/\s+/gu, ' ').trim();
const highlightEnd = /[.!?。！？؟…][\p{Pe}\p{Pf}"']*$/u;
const highlightAbbreviation = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)|\b[A-Z])\.$/u;

function highlightFallbackSegments(text) {
  const segments = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (!/[.!?。！？؟…]/u.test(text[index])) continue;
    let end = index + 1;
    while (end < text.length && /[.!?。！？؟…\p{Pe}\p{Pf}"']/u.test(text[end])) end++;
    // English periods inside decimals, abbreviations and URLs do not end a sentence.
    if (/[.!?]/u.test(text[index]) && end < text.length && !/\s/u.test(text[end])) continue;
    segments.push(text.slice(start, end));
    start = end;
    index = end - 1;
  }
  if (start < text.length) segments.push(text.slice(start));
  return segments;
}

function highlightSourceSentences(source, language, truncated) {
  let segmenter;
  if (typeof Intl.Segmenter === 'function') {
    try { segmenter = new Intl.Segmenter(language || undefined, { granularity: 'sentence' }); }
    catch (_) { segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' }); }
  }
  const sentences = [];
  // Double newlines separate source blocks. Single newlines inside a sentence are whitespace.
  for (const block of source.split(/\n[\t ]*\n+/u)) {
    const text = highlightNormalize(block);
    if (!text) continue;
    const parts = segmenter ? [...segmenter.segment(text)].map(part => part.segment) : highlightFallbackSegments(text);
    const blockSentences = [];
    for (const part of parts) {
      const sentence = highlightNormalize(part);
      if (!sentence) continue;
      const previous = blockSentences.at(-1);
      if (previous && highlightAbbreviation.test(previous)) blockSentences[blockSentences.length - 1] += ' ' + sentence;
      else blockSentences.push(sentence);
    }
    sentences.push(...blockSentences);
  }
  // The input cap can cut the last sentence in half. Never highlight that fragment.
  if (truncated && sentences.length && !highlightEnd.test(sentences.at(-1))) sentences.pop();
  return [...new Set(sentences)];
}

/** Keep source recovery failures alongside complete, unambiguous sentences. */
export function resolveHighlightSelections(prefixes, sourceText, language, truncated = false, sourcePart) {
  if (!Array.isArray(prefixes)) return [{ text: '', status: 'invalid-response' }];
  let sentences = highlightSourceSentences(String(sourceText || ''), language, truncated);
  // A chunk selection must identify a complete original sentence actually present
  // in that chunk. Artificial split boundaries must never become sentence endings.
  if (typeof sourcePart === 'string') {
    const part = highlightNormalize(sourcePart);
    sentences = sentences.filter(sentence => part.includes(sentence));
  }
  const selected = [];
  for (const value of prefixes) {
    if (typeof value !== 'string') { selected.push({ text: '', status: 'invalid-response' }); continue; }
    const prefix = highlightNormalize(value);
    if (!prefix) { selected.push({ text: '', status: 'invalid-response' }); continue; }
    const matches = sentences.filter(sentence => sentence.startsWith(prefix));
    selected.push({ prefix, text: matches.length === 1 ? matches[0] : prefix,
      status: matches.length === 1 ? 'resolved' : matches.length ? 'source-ambiguous' : 'source-unmatched' });
  }
  return mergeHighlightSelections(selected);
}

export function mergeHighlightSelections(selections) {
  const seen = new Set();
  return selections.filter(selection => {
    const key = selection.status + ':' + selection.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Parse the model contract once, before any page matching or persistence. */
export function readHighlightSelections(raw, sourceText, language, truncated = false) {
  const match = String(raw || '').match(/<!--\s*GHOST_HIGHLIGHTS:\s*([\s\S]*?)\s*(?:-->|$)/i);
  if (!match) return [{ text: '', status: 'invalid-response' }];
  try {
    const prefixes = JSON.parse(match[1].trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
    return resolveHighlightSelections(prefixes, sourceText, language, truncated);
  } catch (_) { return [{ text: '', status: 'invalid-response' }]; }
}

/** Compatibility helper for callers that need only recovered sentences. */
export function resolveHighlightPrefixes(prefixes, sourceText, language, truncated = false) {
  return resolveHighlightSelections(prefixes, sourceText, language, truncated)
    .filter(selection => selection.status === 'resolved').map(selection => selection.text);
}
