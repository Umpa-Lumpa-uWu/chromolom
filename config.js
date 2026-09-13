// Flow Local Test Runner - Configuration Constants
// Version 4.0.0

export const CONFIG = Object.freeze({
  // URLs and Hosts
  FLOW_HOME: "https://flow.google.com/",
  FLOW_HOST: "flow.google.com",
  FLOW_URL_PATTERN: /^https:\/\/flow\.google\.com\//,
  
  // Target bundle configuration
  TARGET_HOST: "www.gstatic.com",
  TARGET_BUNDLE_MARKER: "AiSandboxAngularFrontend",
  TARGET_BUNDLE_SUFFIX: "/m=_b",
  
  // CDP and timing constants
  CDP_VERSION: "1.3",
  INTERCEPT_TIMEOUT_MS: 30000,
  SUCCESS_BADGE_MS: 2500,
  UNSUPPORTED_REDIRECT_COOLDOWN_MS: 15000,
  
  // Security limits
  MAX_BUNDLE_SIZE_BYTES: 5 * 1024 * 1024, // 5MB limit
  MAX_DECODE_ATTEMPTS: 3,
  
  // Storage keys
  STORAGE_KEYS: {
    ENABLED: "enabled",
    LAST_ERROR: "lastError",
    LAST_RUN_AT: "lastRunAt",
    LAST_PATCHED_URL: "lastPatchedUrl",
    LAST_PATCH_STRATEGY: "lastPatchStrategy",
    FLOW_PATCH_DIAGNOSTICS: "flowPatchDiagnostics",
    FLOW_PATCH_FORCED_CALLEE: "flowPatchForcedCallee",
    METRICS: "flowMetrics"
  },
  
  // Status definitions
  STATUS: {
    OFF: {
      text: "OFF",
      color: "#5f6368",
      title: "Flow local test: OFF. Click to enable."
    },
    ON: {
      text: "ON",
      color: "#1a73e8",
      title: "Flow local test: ON. New Flow tabs are handled automatically."
    },
    RUN: {
      text: "RUN",
      color: "#f9ab00",
      title: "Preparing Flow local test…"
    },
    OK: {
      text: "OK",
      color: "#188038",
      title: "Flow local test applied. Automatic mode remains ON."
    },
    ERR: {
      text: "ERR",
      color: "#d93025",
      title: "Flow local test stopped. Hover for details."
    }
  },
  
  // Unsupported country URL pattern
  UNSUPPORTED_COUNTRY_PATTERN: /\/(?:unsupported-country)\/?$/,
  AGE_RESTRICTED_PATTERN: /\/(?:age-restricted)\/?$/,
  
  // Patch strategy names
  STRATEGIES: {
    EXACT_ACCESSOR: "known-field-accessor-exact-v2",
    FORCED_CALLEE: "forced-callee-v1",
    ADAPTIVE_CALL: "adaptive-call-v1",
    ROUTE_GUARD: "route-guard-v2",
    SINGLE_31: "adaptive-single31-v1"
  }
});

// Export individual constants for convenience
export const {
  FLOW_HOME,
  FLOW_HOST,
  FLOW_URL_PATTERN,
  TARGET_HOST,
  TARGET_BUNDLE_MARKER,
  TARGET_BUNDLE_SUFFIX,
  CDP_VERSION,
  INTERCEPT_TIMEOUT_MS,
  SUCCESS_BADGE_MS,
  UNSUPPORTED_REDIRECT_COOLDOWN_MS,
  MAX_BUNDLE_SIZE_BYTES,
  MAX_DECODE_ATTEMPTS,
  STORAGE_KEYS,
  STATUS,
  UNSUPPORTED_COUNTRY_PATTERN,
  AGE_RESTRICTED_PATTERN,
  STRATEGIES
} = CONFIG;

export default CONFIG;
