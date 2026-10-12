// Performance profiles + benchmark maths for the local Feed library run.
import assert from 'assert';
import { imp } from './harness.mjs';
const P = await imp('modules/libraryPresets.js');

assert.equal(P.presetOf({ libraryBatch: 20, requestsPerTick: 3, autoProcessMinutes: 30 }), 'balanced');
assert.equal(P.presetOf({ libraryBatch: 10, requestsPerTick: 1, autoProcessMinutes: 60 }), 'eco');
assert.equal(P.presetOf({ libraryBatch: 40, requestsPerTick: 6, autoProcessMinutes: 15 }), 'power');
assert.equal(P.presetOf({ libraryBatch: 40, requestsPerTick: 3, autoProcessMinutes: 15 }), 'custom', 'a hand-changed mix is custom');
assert.equal(P.presetOf({}), 'balanced', 'defaults are the balanced profile');
assert.deepEqual(P.presetSettings('power'), { libraryBatch: 40, requestsPerTick: 6, autoProcessMinutes: 15 });
assert.equal(P.presetSettings('custom'), null);
assert.equal(P.cleanRequests(5), 3, 'unknown request counts fall back to the default');
assert.equal(P.cleanRequests(6), 6);

console.log('TEST 113 OK');
