// libraryBatch.js — process the whole Feed library with a local model (Ollama) in small batches.
//
// Why batches: a local model that gets 300 headlines at once loses the middle ("diluted"); 20 at a time stays
// sharp. It can take hours, but it costs nothing but the user's own machine, so it is only offered for Ollama.
//
// The plan is derived from stored days without a complete recap,
// so stopping and starting again continues where it left off. Nothing here talks to the UI or the AI:
// the caller passes the work functions in (recapDay), which keeps this testable.

export const BATCH_SIZES = [10, 20, 40];
export const DEFAULT_BATCH = 20;

export const cleanBatchSize = (n) => BATCH_SIZES.includes(Number(n)) ? Number(n) : DEFAULT_BATCH;

/** Days whose stored recap does not cover every current item. Today is opt-in. */
export function planLibrary(ctx) {
    const { items, recaps, source, inSource, startOfDay, itemSig } = ctx;
    const today = ctx.today != null ? ctx.today : startOfDay(Date.now());
    const scoped = items.filter((i) => inSource(i));
    const byDay = new Map();
    scoped.forEach((i) => {
        const d = startOfDay(i.published);
        if (d > today || (d === today && !ctx.includeToday)) return;
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(i);
    });
    const days = [];
    [...byDay.keys()].sort((a, b) => a - b).forEach((day) => {
        const all = byDay.get(day).sort((a, b) => b.published - a.published);
        const rc = recaps[`${day}|${source}`];
        const todo = rc ? (rc.covered ? all.filter((x) => rc.covered[x.id] !== itemSig(x)) : []) : all;
        if (todo.length) days.push({ day, total: all.length, todo, hasRecap: !!rc });
    });
    return { days };
}

export const chunksOf = (list, n) => { const out = []; for (let k = 0; k < list.length; k += n) out.push(list.slice(k, k + n)); return out; };

/** Number of recap requests at this batch size. */
export function countRequests(plan, batchSize) {
    return plan.days.reduce((s, d) => s + Math.ceil(d.todo.length / batchSize), 0);
}

/** "about 2 h 10 min" style text from milliseconds (null when unknown). */
export function formatEta(ms, T) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return T('about {m} min', { m: min });
    return T('about {h} h {m} min', { h: Math.floor(min / 60), m: min % 60 });
}

/** Run recap days, saving progress through recapDay's step/tick hooks. Failures are skipped; cancellation stops the run. */
export async function runLibrary(plan, batchSize, { recapDay, onProgress = () => {}, onStage = () => {}, signal } = {}) {
    const total = countRequests(plan, batchSize);
    let done = 0, recapDays = 0, failed = 0, step = null;
    const started = Date.now();
    const report = (phase) => {
        const per = done ? (Date.now() - started) / done : 0;
        onProgress({ phase, doneRequests: done, totalRequests: total, recaps: recapDays, failed, etaMs: per ? per * (total - done) : NaN, elapsedMs: Date.now() - started, step });
    };
    const stopped = () => !!(signal && signal.aborted);
    report('recap');
    for (let d = 0; d < plan.days.length; d++) {
        const entry = plan.days[d];
        if (stopped()) break;
        const batches = Math.ceil(entry.todo.length / batchSize), base = done;
        step = { phase: 'recap', day: entry.day, dayIndex: d + 1, days: plan.days.length, batch: 1, batches, count: Math.min(batchSize, entry.todo.length) };
        report('recap');
        const dayCtx = {
            onStage,
            step: (b) => { step = { ...step, ...b }; report('recap'); },
            tick: () => { done = Math.min(base + batches, done + 1); report('recap'); }
        };
        try { await recapDay(entry, batchSize, signal, dayCtx); recapDays++; }
        catch (e) { if (stopped() || (e && e.cancelled)) break; failed++; }
        done = base + batches;
        report('recap');
    }
    step = null;
    return { recaps: recapDays, failed, stopped: stopped(), doneRequests: done, totalRequests: total, elapsedMs: Date.now() - started };
}
