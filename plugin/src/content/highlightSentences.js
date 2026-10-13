// Expand model-selected prefixes against the source text before matching any webpage DOM.
const highlightNormalize = (text) => text.replace(/\s+/gu, ' ').trim();
const highlightEnd = /[.!?。！？؟…][\p{Pe}\p{Pf}"']*$/u;
// Initials must be standalone tokens; the final E in Wall-E is not an initial.
const highlightAbbreviation = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\.|(?:^|[\s\p{Ps}\p{Pi}"'])[A-Z]\.)$/u;

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

function highlightSourceBlocks(source, language, truncated) {
  let segmenter;
  if (typeof Intl.Segmenter === 'function') {
    try { segmenter = new Intl.Segmenter(language || undefined, { granularity: 'sentence' }); }
    catch (_) { segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' }); }
  }
  const blocks = [];
  // Double newlines separate source blocks. Single newlines inside a sentence are whitespace.
  for (const block of source.split(/\n[\t ]*\n+/u)) {
    const text = highlightNormalize(block);
    if (!text) continue;
    const parts = segmenter ? [...segmenter.segment(text)].map(part => part.segment) : highlightFallbackSegments(text);
    const blockSentences = [];
    let offset = 0;
    for (const part of parts) {
      const sentence = highlightNormalize(part);
      const start = offset + part.indexOf(sentence);
      const end = start + sentence.length;
      offset += part.length;
      if (!sentence) continue;
      const previous = blockSentences.at(-1);
      if (previous && highlightAbbreviation.test(text.slice(previous.start, previous.end))) previous.end = end;
      else blockSentences.push({ start, end });
    }
    blocks.push({ text, sentences: blockSentences });
  }
  // The input cap can cut the last sentence in half. Never highlight that fragment.
  const last = blocks.at(-1);
  const tail = last?.sentences.at(-1);
  if (truncated && tail && !highlightEnd.test(last.text.slice(tail.start, tail.end))) last.sentences.pop();
  return blocks;
}

function highlightSentenceContaining(sentences, position) {
  let lo = 0, hi = sentences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const sentence = sentences[mid];
    if (position < sentence.start) hi = mid - 1;
    else if (position >= sentence.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function highlightStartsWithinWord(text, position, prefix) {
  // A prefix can start inside a sentence, but not inside an alphabetic word.
  // Chinese and Japanese text has no required spaces between words.
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(prefix)) return false;
  return /[\p{L}\p{N}\p{M}_]$/u.test(text.slice(Math.max(0, position - 2), position))
    && /^[\p{L}\p{N}\p{M}_]/u.test(prefix);
}

/** Recover the first complete match in source order, keeping genuinely missing prefixes as failures. */
export function resolveHighlightSelections(prefixes, sourceText, language, truncated = false, sourcePart) {
  if (!Array.isArray(prefixes)) return [{ text: '', status: 'invalid-response' }];
  const blocks = highlightSourceBlocks(String(sourceText || ''), language, truncated);
  // A chunk selection must identify a complete original sentence actually present
  // in that chunk. Artificial split boundaries must never become sentence endings.
  const part = typeof sourcePart === 'string' ? highlightNormalize(sourcePart) : null;
  const selected = [];
  for (const value of prefixes) {
    if (typeof value !== 'string') { selected.push({ text: '', status: 'invalid-response' }); continue; }
    const prefix = highlightNormalize(value);
    if (!prefix) { selected.push({ text: '', status: 'invalid-response' }); continue; }
    let match = null;
    source: for (const block of blocks) {
      const { sentences } = block;
      for (let position = block.text.indexOf(prefix); position !== -1; position = block.text.indexOf(prefix, position + 1)) {
        if (highlightStartsWithinWord(block.text, position, prefix)) continue;
        const first = highlightSentenceContaining(sentences, position);
        const last = highlightSentenceContaining(sentences, position + prefix.length - 1);
        if (first < 0 || last < 0) continue; // excludes a removed, truncated sentence
        // Recover all complete sentences touched by the exact prefix, including
        // opening clauses before a comma or colon. Never cross source blocks.
        const text = block.text.slice(sentences[first].start, sentences[last].end);
        if (part === null || part.includes(text)) { match = text; break source; }
      }
    }
    selected.push({ prefix, text: match || prefix, status: match ? 'resolved' : 'source-unmatched' });
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
