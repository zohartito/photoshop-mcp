import assert from 'node:assert/strict';
import { UxpReplayTombstones } from '../src/platform/uxp-replay-tombstones.js';

let now = 1_000;
const tombstones = new UxpReplayTombstones(2, 3, 100, () => now);

tombstones.add('a');
tombstones.add('b');
assert.equal(tombstones.size, 2);
assert.equal(tombstones.has('a'), true, 'lookup refreshes LRU recency');
tombstones.add('c');
assert.equal(tombstones.has('a'), true);
assert.equal(tombstones.has('b'), false, 'least-recent replay tombstone is evicted first');
assert.equal(tombstones.has('c'), true);
assert.equal(tombstones.retainedBytes <= 3, true, 'aggregate replay bytes stay bounded');

now += 101;
assert.equal(tombstones.has('a'), false, 'expired replay tombstone is removed');
assert.equal(tombstones.size, 0);

console.log('UXP replay tombstones: bounded LRU and TTL assertions passed');
