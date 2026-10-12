// libraryPresets.js — performance profiles for processing the Feed library with a local model, and the benchmark maths.
//
// A profile is just a named set of the knobs that already exist: items per request, AI requests per run, run interval.
// The benchmark times a fixed rating batch on THIS machine and turns it into numbers per profile ("a run takes about
// 40 s, 120 items per hour"). The reference classes are rough, hand-written orders of magnitude for typical setups so
// the user can place their own result; nothing is collected from other users and nothing leaves the machine.

export const PRESETS = {
    eco:      { batch: 10, requests: 1, minutes: 60 },
    balanced: { batch: 20, requests: 3, minutes: 30 },
    power:    { batch: 40, requests: 6, minutes: 15 }
};
export const PRESET_IDS = ['eco', 'balanced', 'power'];
export const REQUEST_STEPS = [1, 2, 3, 4, 6, 8];
export const DEFAULT_REQUESTS = 3;
export const cleanRequests = (n) => REQUEST_STEPS.includes(Number(n)) ? Number(n) : DEFAULT_REQUESTS;

/** Which profile do these settings match? 'custom' when they were changed by hand. */
export function presetOf(s = {}) {
    const batch = Number(s.libraryBatch) || 20, requests = cleanRequests(s.requestsPerTick), minutes = Number(s.autoProcessMinutes) || 30;
    return PRESET_IDS.find((id) => PRESETS[id].batch === batch && PRESETS[id].requests === requests && PRESETS[id].minutes === minutes) || 'custom';
}

/** Settings keys a profile sets. */
export const presetSettings = (id) => PRESETS[id] ? { libraryBatch: PRESETS[id].batch, requestsPerTick: PRESETS[id].requests, autoProcessMinutes: PRESETS[id].minutes } : null;
