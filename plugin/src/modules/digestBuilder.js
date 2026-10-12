// digestBuilder.js
// Two jobs:
//   1. buildMagazineArticle() combines N saved articles into one
//      synthetic article-shaped object ({ title, content, summary, url }).
//      It plugs straight into the existing single-article pipeline —
//      sendToKindle(), dispatchToLocalSend(), exportToMarkdown(),
//      shareArticle() — none of which need to know a "magazine" concept
//      exists. No new delivery code required.
//   2. curateDigest() picks a good set of articles for that bundle
//      automatically: recency + TF-IDF topical diversity (reusing the
//      same index search/similar-articles already build).

import { cosineSim } from './localSearch.js';
import { T, TN } from './feedI18n.js';
import { markHighlights, renderAnnotationsHtml } from './annotationExporter.js';
import { escapeHtml } from './textUtils.js';

/**
 * Combine articles into one synthetic "magazine" article. Bundles
 * summaries (with source links), not full original content — a 5-article
 * bundle of full text would be huge and mostly redundant with just
 * reading each article individually.
 */
export function buildMagazineArticle(articles, { title, includeContent = false, intro = '' } = {}) {
    const ordered = [...articles].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const magazineTitle = title || T('Reading bundle — {date} ({count})', { date: new Date().toLocaleDateString(), count: TN(ordered.length, '{n} article', '{n} articles') });

    const toc = ordered.map((a, i) =>
        `<li><a href="#aish-mag-${i}">${escapeHtml(a.title || T('Untitled'))}</a></li>`
    ).join('');

    const sections = ordered.map((a, i) => {
        const domain = a.url ? (() => { try { return new URL(a.url).hostname; } catch { return ''; } })() : '';
        return `
          <h2 id="aish-mag-${i}">${escapeHtml(a.title || T('Untitled'))}</h2>
          <p style="color:#666;font-style:italic;">${a.url ? `<a href="${escapeHtml(a.url)}">${escapeHtml(domain)}</a> &middot; ` : ''}${new Date(a.timestamp).toLocaleDateString()}</p>
          <div>${markHighlights(a.summary || '', a.annotations)}</div>
          ${includeContent && a.content ? `<h3>${escapeHtml(T('Full article'))}</h3><div>${markHighlights(a.content, a.annotations)}</div>` : ''}
          ${renderAnnotationsHtml(a.annotations, { level: 3 })}
          <hr />
        `;
    }).join('\n');

    // The delivery templates (LocalSend/Share HTML, Kindle) already print the title and the summary above the
    // content, so the body carries neither: only the intro, the table of contents and the sections.
    const content = `
      <div>
        ${intro ? `<blockquote class="aish-intro" style="border-left:4px solid #c9a227;margin:14px 0;padding:2px 0 2px 12px;font-style:italic;">${escapeHtml(intro)}</blockquote>` : ''}
        <ol>${toc}</ol>
        <hr />
        ${sections}
      </div>
    `;

    return {
        title: magazineTitle,
        content,
        summary: `${T('A bundle of {count}: {titles}', { count: TN(ordered.length, '{n} article', '{n} articles'), titles: ordered.map(a => a.title).filter(Boolean).slice(0, 5).join(', ') + (ordered.length > 5 ? '…' : '') })}`,
        url: '',
        timestamp: new Date().toISOString(),
        isMagazine: true,
        articleCount: ordered.length,
        sourceTimestamps: ordered.map(a => a.timestamp)
    };
}

const RECENCY_HALF_LIFE_DAYS = 14;

function recencyScore(article) {
    const ageDays = (Date.now() - new Date(article.timestamp).getTime()) / 86400000;
    return Math.pow(0.5, Math.max(0, ageDays) / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Picks up to maxArticles articles for a personal digest.
 *   - Candidate pool: explicit "Save for Later" articles first, topped up
 *     with the most recent other saves if there aren't enough.
 *   - Greedy MMR-style selection: pick the best-recency article, then
 *     repeatedly pick whichever remaining candidate maximizes
 *     (recency - diversityWeight * similarity to what's already picked),
 *     using the shared TF-IDF index so the digest doesn't repeat the same
 *     story five times.
 *
 * @param {Array<object>} articles
 * @param {object|null} index - prebuilt TF-IDF index from localSearch.js
 * @param {{ maxArticles?: number, poolSize?: number }} opts
 */
export async function curateDigest(articles, index, { maxArticles = 5, poolSize = 25 } = {}) {
    let pool = articles.filter(a => a.isDecision);
    if (pool.length < maxArticles) {
        const rest = articles
            .filter(a => !a.isDecision)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        pool = pool.concat(rest);
    }
    pool = pool.slice(0, poolSize); // bound the candidate pool

    const scoredPool = pool.map(a => ({ article: a, recency: recencyScore(a) }));

    if (scoredPool.length === 0) return [];

    const DIVERSITY_WEIGHT = 0.6;
    const remaining = [...scoredPool].sort((a, b) => b.recency - a.recency);
    const selected = [remaining.shift()];

    while (selected.length < maxArticles && remaining.length > 0) {
        let bestIdx = 0;
        let bestScore = -Infinity;
        remaining.forEach((entry, i) => {
            const vec = index?.vectors?.get(entry.article.timestamp);
            let maxSim = 0;
            if (vec) {
                for (const s of selected) {
                    const sVec = index?.vectors?.get(s.article.timestamp);
                    if (sVec) maxSim = Math.max(maxSim, cosineSim(vec, sVec));
                }
            }
            const score = entry.recency - DIVERSITY_WEIGHT * maxSim;
            if (score > bestScore) { bestScore = score; bestIdx = i; }
        });
        selected.push(remaining.splice(bestIdx, 1)[0]);
    }

    return selected.map(s => s.article);
}
