/**
 * Flow Local Test Runner - Unit Tests for metrics.js
 * Version 4.0.0
 */

import { test } from 'node:test';
import assert from 'node:assert';

// In-memory chrome.storage.local mock.
const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      set: async (payload) => {
        for (const [key, value] of Object.entries(payload)) store.set(key, value);
      },
      get: async (key) => ({ [key]: store.get(key) })
    }
  }
};

const { MetricsTracker, metricsTracker } = await import('../metrics.js');

test('recordAttempt counts successes and failures', () => {
  const tracker = new MetricsTracker();
  tracker.recordAttempt({ success: true, strategy: 'route-guard-v2', processingTimeMs: 120 });
  tracker.recordAttempt({ success: true, strategy: 'route-guard-v2', processingTimeMs: 280 });
  tracker.recordAttempt({ success: false, error: 'boom' });

  const summary = tracker.getSummary();
  assert.strictEqual(summary.totalAttempts, 3);
  assert.strictEqual(summary.successfulPatches, 2);
  assert.strictEqual(summary.failedPatches, 1);
  assert.strictEqual(summary.successRate, 67);
  assert.strictEqual(summary.avgProcessingTimeMs, 200);
  assert.deepStrictEqual(summary.strategyUsage, { 'route-guard-v2': 2 });
  assert.strictEqual(summary.lastError, 'boom');
});

test('processing times keep only the last 100 measurements', () => {
  const tracker = new MetricsTracker();
  for (let i = 0; i < 150; i += 1) {
    tracker.recordAttempt({ success: true, strategy: 'x', processingTimeMs: i });
  }
  // Only the last 100 samples (50..149) count; mean is 99.5 -> rounds to 100.
  assert.strictEqual(tracker.getSummary().avgProcessingTimeMs, 100);
});

test('success rate is 0 before any attempt', () => {
  assert.strictEqual(new MetricsTracker().getSummary().successRate, 0);
});

test('persist and loadPersisted round-trip through storage', async () => {
  const tracker = new MetricsTracker();
  tracker.recordAttempt({ success: true, strategy: 'forced-callee-v1', processingTimeMs: 42 });

  await tracker.persist();
  const loaded = await tracker.loadPersisted();

  assert.strictEqual(loaded.totalAttempts, 1);
  assert.strictEqual(loaded.successfulPatches, 1);
  assert.strictEqual(loaded.strategyUsage['forced-callee-v1'], 1);
  assert.ok(loaded.persistedAt, 'persist must stamp a timestamp');
});

test('loadPersisted returns null when nothing is stored', async () => {
  store.clear(); // previous tests persisted into the shared mock
  const tracker = new MetricsTracker();
  assert.strictEqual(await tracker.loadPersisted(), null);
});

test('clear resets all counters', () => {
  const tracker = new MetricsTracker();
  tracker.recordAttempt({ success: false, error: 'x' });
  tracker.clear();

  const summary = tracker.getSummary();
  assert.strictEqual(summary.totalAttempts, 0);
  assert.strictEqual(summary.failedPatches, 0);
  assert.strictEqual(summary.lastError, null);
});

test('the shared singleton is usable', () => {
  assert.ok(metricsTracker instanceof MetricsTracker);
});
