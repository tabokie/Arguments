// textMetrics.js
// Readability and lexical diversity from locally stored text.

import { stripHtml, tokenize, countSyllables } from './textUtils.js';
import { T } from './feedI18n.js';

const WPM = 200; // shared with analyticsManager.js's time-savings estimate

/**
 * Flesch Reading Ease + Flesch-Kincaid Grade Level from raw HTML/text.
 * @returns {{ ease: number, grade: number, label: string, words: number } | null}
 */
export function readingLevel(html) {
    const text = stripHtml(html);
    if (!text || text.length < 20) return null;

    const sentences = text.split(/[.!?]+(?:\s|$)/).map(s => s.trim()).filter(Boolean);
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0 || sentences.length === 0) return null;

    let syllables = 0;
    for (const w of words) syllables += countSyllables(w);

    const wordsPerSentence = words.length / sentences.length;
    const syllablesPerWord = syllables / words.length;

    const ease = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
    const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

    let label;
    if (ease >= 80) label = T('Easy');
    else if (ease >= 60) label = T('Standard');
    else if (ease >= 40) label = T('Fairly hard');
    else label = T('Hard');

    return {
        ease: Math.round(Math.max(0, Math.min(100, ease))),
        grade: Math.round(Math.max(0, grade) * 10) / 10,
        label,
        words: words.length
    };
}

/** Lexical diversity (unique words / total words) — a cheap "density" signal. */
export function lexicalDiversity(html) {
    const words = tokenize(html, { removeStopwords: false, minLength: 1 });
    if (words.length === 0) return null;
    const unique = new Set(words).size;
    return Math.round((unique / words.length) * 100) / 100;
}

/** Convenience: compute everything at once for an article's detail view. */
export async function computeMetrics(article) {
    const source = article.content || article.html || article.summary || '';
    const level = readingLevel(source);
    return {
        readingLevel: level,
        lexicalDiversity: lexicalDiversity(source),
        estimatedMinutes: level ? Math.max(1, Math.round(level.words / WPM)) : null
    };
}
