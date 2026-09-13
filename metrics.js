// Flow Local Test Runner - Metrics and Monitoring Module
// Version 4.0.0

import { STORAGE_KEYS } from './config.js';

/**
 * Metrics tracking for extension performance and success rates
 */
export class MetricsTracker {
  constructor() {
    this.sessionMetrics = {
      startTime: Date.now(),
      totalAttempts: 0,
      successfulPatches: 0,
      failedPatches: 0,
      strategyUsage: {},
      avgProcessingTimeMs: 0,
      processingTimes: [],
      lastError: null,
      lastErrorAt: null
    };
  }

  /**
   * Record a patch attempt
   * @param {Object} params - Attempt parameters
   * @param {boolean} params.success - Whether the patch succeeded
   * @param {string|null} params.strategy - Strategy used if successful
   * @param {number} params.processingTimeMs - Time taken to process
   * @param {string|null} params.error - Error message if failed
   */
  recordAttempt({ success, strategy, processingTimeMs, error }) {
    const metrics = this.sessionMetrics;
    metrics.totalAttempts += 1;

    if (success) {
      metrics.successfulPatches += 1;
      if (strategy) {
        metrics.strategyUsage[strategy] = (metrics.strategyUsage[strategy] || 0) + 1;
      }
    } else {
      metrics.failedPatches += 1;
      metrics.lastError = error;
      metrics.lastErrorAt = new Date().toISOString();
    }

    if (typeof processingTimeMs === 'number' && processingTimeMs >= 0) {
      metrics.processingTimes.push(processingTimeMs);
      // Keep only last 100 measurements
      if (metrics.processingTimes.length > 100) {
        metrics.processingTimes.shift();
      }
      // Recalculate average
      const sum = metrics.processingTimes.reduce((a, b) => a + b, 0);
      metrics.avgProcessingTimeMs = Math.round(sum / metrics.processingTimes.length);
    }
  }

  /**
   * Get current metrics summary
   * @returns {Object} Metrics summary
   */
  getSummary() {
    const m = this.sessionMetrics;
    return {
      totalAttempts: m.totalAttempts,
      successfulPatches: m.successfulPatches,
      failedPatches: m.failedPatches,
      successRate: m.totalAttempts > 0 
        ? Math.round((m.successfulPatches / m.totalAttempts) * 100) 
        : 0,
      strategyUsage: { ...m.strategyUsage },
      avgProcessingTimeMs: m.avgProcessingTimeMs,
      lastError: m.lastError,
      lastErrorAt: m.lastErrorAt,
      sessionDurationMs: Date.now() - m.startTime
    };
  }

  /**
   * Persist metrics to storage
   * @returns {Promise<void>}
   */
  async persist() {
    try {
      const summary = this.getSummary();
      await chrome.storage.local.set({
        [STORAGE_KEYS.METRICS]: {
          ...summary,
          persistedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.warn('[FlowMetrics] Failed to persist metrics:', error);
    }
  }

  /**
   * Load persisted metrics from storage
   * @returns {Promise<Object|null>} Previously stored metrics or null
   */
  async loadPersisted() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEYS.METRICS);
      return data[STORAGE_KEYS.METRICS] || null;
    } catch {
      return null;
    }
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.sessionMetrics = {
      startTime: Date.now(),
      totalAttempts: 0,
      successfulPatches: 0,
      failedPatches: 0,
      strategyUsage: {},
      avgProcessingTimeMs: 0,
      processingTimes: [],
      lastError: null,
      lastErrorAt: null
    };
  }
}

// Singleton instance
export const metricsTracker = new MetricsTracker();
export default metricsTracker;
