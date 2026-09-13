// Flow Local Test Runner - Background Service Worker
// Version 4.0.0

import {
  FLOW_HOME,
  FLOW_HOST,
  FLOW_URL_PATTERN,
  TARGET_HOST,
  TARGET_BUNDLE_MARKER,
  TARGET_BUNDLE_SUFFIX,
  UNSUPPORTED_COUNTRY_PATTERN,
  CDP_VERSION,
  INTERCEPT_TIMEOUT_MS,
  SUCCESS_BADGE_MS,
  UNSUPPORTED_REDIRECT_COOLDOWN_MS,
  STORAGE_KEYS,
  STATUS
} from "./config.js";
import { patchSource } from "./patch.js";
import { validateUrl, validateBundleSize, sanitizeErrorMessage } from "./security.js";
import { metricsTracker } from "./metrics.js";

const sessions = new Map();
const startingTabs = new Set();
const lastUnsupportedRedirectAt = new Map();

let enabled = true;
let forcedCallee;

function errorMessage(error) {
  return sanitizeErrorMessage(error);
}

async function setStatus(tabId, statusName, detail) {
  const status = STATUS[statusName] || STATUS.ON;
  const target = Number.isInteger(tabId) ? { tabId } : {};
  const title = detail ? `${status.title} ${detail}` : status.title;

  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ ...target, color: status.color }),
    chrome.action.setBadgeText({ ...target, text: status.text }),
    chrome.action.setTitle({ ...target, title })
  ]);
}

async function safeSetStatus(tabId, statusName, detail) {
  try {
    await setStatus(tabId, statusName, detail);
  } catch {
    // Status update is best-effort.
  }
}

function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || "Failed to attach debugger."));
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

function detachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.detach({ tabId }, () => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || "Failed to detach debugger."));
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

function send(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || `${method} failed.`));
        } else {
          resolve(result);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

function isFlowUrl(url) {
  return FLOW_URL_PATTERN.test(url || "");
}

function isUnsupportedCountryUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === FLOW_HOST &&
      UNSUPPORTED_COUNTRY_PATTERN.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isTargetBundle(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === TARGET_HOST &&
      parsed.pathname.includes(TARGET_BUNDLE_MARKER) &&
      parsed.pathname.endsWith(TARGET_BUNDLE_SUFFIX)
    );
  } catch {
    return false;
  }
}

function markUnsupportedRedirect(tabId) {
  lastUnsupportedRedirectAt.set(tabId, Date.now());
}

function redirectedRecently(tabId) {
  const lastRedirect = lastUnsupportedRedirectAt.get(tabId) || 0;
  return Date.now() - lastRedirect < UNSUPPORTED_REDIRECT_COOLDOWN_MS;
}

function clearTabState(tabId) {
  const session = sessions.get(tabId);
  if (session?.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  sessions.delete(tabId);
  startingTabs.delete(tabId);
  lastUnsupportedRedirectAt.delete(tabId);
}

// CDP hands us the decoded body, so a base64 payload is ~4/3 of the real
// byte length. Used purely to enforce MAX_BUNDLE_SIZE_BYTES before decoding.
function estimateByteLength(response) {
  const body = response?.body ?? "";
  if (!response.base64Encoded) {
    return body.length;
  }
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

function decodeResponseBody(response) {
  if (!response || typeof response.body !== "string") {
    throw new Error("Response body is empty.");
  }

  if (!response.base64Encoded) {
    return response.body;
  }

  const binary = atob(response.body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return {
    body: btoa(binary),
    byteLength: bytes.byteLength
  };
}

function buildResponseHeaders(headers, byteLength) {
  const replacedHeaders = new Set([
    "age",
    "cache-control",
    "content-encoding",
    "content-length",
    "content-md5",
    "etag",
    "transfer-encoding"
  ]);

  const originalHeaders = Array.isArray(headers) ? headers : [];
  const result = originalHeaders.filter(
    (header) => !replacedHeaders.has(header.name.toLowerCase())
  );

  result.push({ name: "Cache-Control", value: "no-store" });
  result.push({ name: "Content-Length", value: String(byteLength) });

  return result;
}

async function syncForcedCallee() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.FLOW_PATCH_FORCED_CALLEE);
    const value = stored[STORAGE_KEYS.FLOW_PATCH_FORCED_CALLEE];
    forcedCallee =
      typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    // Best-effort.
  }
}

async function detach(tabId, finalStatus, detail) {
  const session = sessions.get(tabId);
  if (session?.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  sessions.delete(tabId);
  startingTabs.delete(tabId);

  try {
    await send(tabId, "Fetch.disable");
  } catch {}

  try {
    await send(tabId, "Network.setCacheDisabled", { cacheDisabled: false });
  } catch {}

  try {
    await send(tabId, "Network.setBypassServiceWorker", { bypass: false });
  } catch {}

  try {
    await detachDebugger(tabId);
  } catch {}

  await safeSetStatus(tabId, finalStatus, detail);

  if (finalStatus === "OK" && enabled) {
    setTimeout(() => {
      if (enabled && !sessions.has(tabId)) {
        void safeSetStatus(tabId, "ON");
      }
    }, SUCCESS_BADGE_MS);
  }
}

/** Persist a failure that is not tied to an active session. */
async function recordFailure(detail) {
  const safeDetail = sanitizeErrorMessage(detail);

  metricsTracker.recordAttempt({ success: false, strategy: null, error: safeDetail });
  void metricsTracker.persist();

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_ERROR]: safeDetail,
      [STORAGE_KEYS.LAST_PATCH_STRATEGY]: null,
      [STORAGE_KEYS.LAST_RUN_AT]: new Date().toISOString()
    });
  } catch {}

  return safeDetail;
}

async function failSession(tabId, detail) {
  const safeDetail = sanitizeErrorMessage(detail);
  const session = sessions.get(tabId);
  const startedAt = session?.startedAt;

  metricsTracker.recordAttempt({
    success: false,
    strategy: null,
    processingTimeMs: startedAt ? Date.now() - startedAt : undefined,
    error: safeDetail
  });
  void metricsTracker.persist();

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_ERROR]: safeDetail,
      [STORAGE_KEYS.LAST_PATCH_STRATEGY]: null,
      [STORAGE_KEYS.LAST_RUN_AT]: new Date().toISOString()
    });
  } catch {}

  await detach(tabId, "ERR", safeDetail);
}

async function completeSession(tabId, url, strategy = null) {
  const session = sessions.get(tabId);
  const shouldReturnHome = session?.returnHome === true;
  const redirectWasSuppressed = session?.redirectSuppressed === true;
  const statusError = redirectWasSuppressed
    ? "Repeated unsupported-country redirect was stopped."
    : null;

  metricsTracker.recordAttempt({
    success: true,
    strategy,
    processingTimeMs: session?.startedAt ? Date.now() - session.startedAt : undefined
  });
  void metricsTracker.persist();

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_ERROR]: statusError,
      [STORAGE_KEYS.LAST_PATCHED_URL]: url,
      [STORAGE_KEYS.LAST_PATCH_STRATEGY]: strategy,
      [STORAGE_KEYS.LAST_RUN_AT]: new Date().toISOString()
    });
  } catch {}

  if (!shouldReturnHome && !redirectWasSuppressed) {
    lastUnsupportedRedirectAt.delete(tabId);
  }

  await detach(
    tabId,
    redirectWasSuppressed ? "ERR" : "OK",
    redirectWasSuppressed ? statusError : undefined
  );

  if (shouldReturnHome && enabled) {
    markUnsupportedRedirect(tabId);
    try {
      await chrome.tabs.update(tabId, { url: FLOW_HOME });
    } catch {}
  }
}

async function continueOriginal(tabId, requestId) {
  try {
    await send(tabId, "Fetch.continueRequest", { requestId });
  } catch {}
}

async function handlePausedResponse(source, params) {
  const tabId = source.tabId;
  if (!Number.isInteger(tabId)) {
    return;
  }

  const session = sessions.get(tabId);

  if (!session) {
    await continueOriginal(tabId, params.requestId);
    return;
  }

  if (!isTargetBundle(params.request?.url || "")) {
    await continueOriginal(tabId, params.requestId);
    return;
  }

  if (session.handling) {
    await continueOriginal(tabId, params.requestId);
    return;
  }

  session.handling = true;
  let fulfilled = false;

  try {
    if (
      !params.responseStatusCode ||
      params.responseStatusCode < 200 ||
      params.responseStatusCode >= 300
    ) {
      throw new Error(
        `Unexpected bundle response status: ${params.responseStatusCode || "unknown"}.`
      );
    }

    const urlCheck = validateUrl(params.request.url);
    if (!urlCheck.valid) {
      throw new Error(`Bundle URL rejected: ${urlCheck.reason}.`);
    }

    const response = await send(tabId, "Fetch.getResponseBody", {
      requestId: params.requestId
    });

    const sizeCheck = validateBundleSize(estimateByteLength(response));
    if (!sizeCheck.valid) {
      throw new Error(`Bundle rejected: ${sizeCheck.reason}.`);
    }

    const sourceText = decodeResponseBody(response);
    const patchResult = patchSource(sourceText, { forcedCallee });

    if (!patchResult.ok) {
      throw new Error(patchResult.error);
    }

    const encoded = encodeBase64(patchResult.source);

    await send(tabId, "Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: params.responseStatusCode,
      responsePhrase: params.responseStatusText || "OK",
      responseHeaders: buildResponseHeaders(
        params.responseHeaders,
        encoded.byteLength
      ),
      body: encoded.body
    });

    fulfilled = true;

    await completeSession(
      tabId,
      params.request.url,
      patchResult.strategy || null
    );
  } catch (error) {
    if (!fulfilled) {
      await continueOriginal(tabId, params.requestId);
    }
    await failSession(tabId, errorMessage(error));
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === "Fetch.requestPaused" && Number.isInteger(source.tabId)) {
    void handlePausedResponse(source, params);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!Number.isInteger(source.tabId)) {
    return;
  }
  const tabId = source.tabId;
  const session = sessions.get(tabId);
  startingTabs.delete(tabId);
  if (!session) {
    return;
  }
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  sessions.delete(tabId);
  void safeSetStatus(
    tabId,
    enabled ? "ERR" : "OFF",
    `Debugger detached: ${reason}.`
  );
});

async function startSession(tabId, navigationUrl) {
  if (!enabled || !Number.isInteger(tabId)) {
    return;
  }
  if (sessions.has(tabId) || startingTabs.has(tabId)) {
    return;
  }

  startingTabs.add(tabId);
  await safeSetStatus(tabId, "RUN");

  try {
    const targetUrl = isFlowUrl(navigationUrl) ? navigationUrl : FLOW_HOME;

    await attachDebugger(tabId);

    if (!enabled) {
      try {
        await detachDebugger(tabId);
      } catch {}
      await safeSetStatus(tabId, "OFF");
      return;
    }

    const timeoutId = setTimeout(() => {
      const session = sessions.get(tabId);
      if (!session) {
        return;
      }
      const shouldReturnHome = session.returnHome === true;
      void failSession(
        tabId,
        `Target bundle was not intercepted within ${INTERCEPT_TIMEOUT_MS / 1000} seconds.`
      ).then(async () => {
        if (shouldReturnHome && enabled) {
          markUnsupportedRedirect(tabId);
          try {
            await chrome.tabs.update(tabId, { url: FLOW_HOME });
          } catch {}
        }
      });
    }, INTERCEPT_TIMEOUT_MS);

    sessions.set(tabId, {
      handling: false,
      timeoutId,
      returnHome: false,
      redirectSuppressed: false,
      startedAt: Date.now()
    });

    try {
      await send(tabId, "Page.stopLoading");
    } catch {}

    await send(tabId, "Page.enable");
    await send(tabId, "Network.enable");
    await send(tabId, "Network.setCacheDisabled", { cacheDisabled: true });

    try {
      await send(tabId, "Network.setBypassServiceWorker", { bypass: true });
    } catch {}

    await send(tabId, "Fetch.enable", {
      patterns: [
        {
          urlPattern: `https://${TARGET_HOST}/*${TARGET_BUNDLE_MARKER}*`,
          resourceType: "Script",
          requestStage: "Response"
        }
      ]
    });

    await send(tabId, "Page.navigate", { url: targetUrl });
  } catch (error) {
    const detail = errorMessage(error);
    if (sessions.has(tabId)) {
      await failSession(tabId, detail);
    } else {
      try {
        await detachDebugger(tabId);
      } catch {}
      await recordFailure(detail);
      await safeSetStatus(tabId, "ERR", detail);
    }
  } finally {
    startingTabs.delete(tabId);
  }
}

async function chooseFlowTab(clickedTab) {
  if (Number.isInteger(clickedTab?.id) && isFlowUrl(clickedTab.url)) {
    return clickedTab;
  }

  const existingTabs = await chrome.tabs.query({ url: `${FLOW_HOME}*` });

  if (existingTabs.length > 0 && Number.isInteger(existingTabs[0].id)) {
    try {
      await chrome.tabs.update(existingTabs[0].id, { active: true });
    } catch {}
    if (Number.isInteger(existingTabs[0].windowId)) {
      try {
        await chrome.windows.update(existingTabs[0].windowId, { focused: true });
      } catch {}
    }
    return existingTabs[0];
  }

  return chrome.tabs.create({ active: true, url: "about:blank" });
}

async function stopAllSessions() {
  const activeTabIds = [...sessions.keys()];
  const pendingTabIds = [...startingTabs];
  startingTabs.clear();

  await Promise.allSettled([
    ...activeTabIds.map((tabId) =>
      detach(tabId, "OFF", "Automatic mode is disabled.")
    ),
    ...pendingTabIds.map((tabId) =>
      detachDebugger(tabId).catch(() => {})
    )
  ]);
}

async function toggleAutomaticMode(clickedTab) {
  enabled = !enabled;
  await chrome.storage.local.set({ enabled });

  if (!enabled) {
    await stopAllSessions();
    await safeSetStatus(undefined, "OFF");
    return;
  }

  await safeSetStatus(undefined, "ON");

  const targetTab = await chooseFlowTab(clickedTab);
  if (!Number.isInteger(targetTab?.id)) {
    throw new Error("Chrome did not return a target tab ID.");
  }

  await startSession(
    targetTab.id,
    isFlowUrl(targetTab.url) ? targetTab.url : FLOW_HOME
  );
}

async function initializeEnabledState() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.ENABLED);
    enabled = stored[STORAGE_KEYS.ENABLED] !== false;
    if (typeof stored[STORAGE_KEYS.ENABLED] !== "boolean") {
      await chrome.storage.local.set({ [STORAGE_KEYS.ENABLED]: true });
    }
  } catch {
    enabled = true;
  }

  await syncForcedCallee();

  // Do not clobber a per-tab RUN/OK/ERR badge while a session is in flight.
  if (sessions.size === 0) {
    await safeSetStatus(undefined, enabled ? "ON" : "OFF");
  }
}

// The service worker is re-evaluated on every wake-up, and onInstalled /
// onStartup both fire on the already-initialised module. Keep it idempotent.
let enabledReady = null;
function ensureInitialized() {
  if (!enabledReady) {
    enabledReady = initializeEnabledState().catch(() => {});
  }
  return enabledReady;
}

ensureInitialized();

chrome.action.onClicked.addListener((tab) => {
  void ensureInitialized()
    .then(() => toggleAutomaticMode(tab))
    .catch(async (error) => {
      const detail = await recordFailure(errorMessage(error));
      await safeSetStatus(tab?.id, "ERR", detail);
    });
});

chrome.commands.onCommand.addListener((command) => {
  // NOTE: `_execute_action` is a reserved command — Chrome never dispatches it
  // to `commands.onCommand`; it triggers `chrome.action.onClicked` instead.
  // Handling it here would be unreachable code.
  if (command === "open_status") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("status.html") });
  }
});

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) {
      return;
    }

    const tabId = details.tabId;
    const url = details.url || "";
    const unsupported = isUnsupportedCountryUrl(url);
    const session = sessions.get(tabId);

    if (session) {
      if (unsupported) {
        if (redirectedRecently(tabId)) {
          session.redirectSuppressed = true;
          if (!session.handling) {
            void failSession(
              tabId,
              "Repeated unsupported-country redirect was stopped."
            );
          }
        } else {
          session.returnHome = true;
          markUnsupportedRedirect(tabId);
        }
      }
      return;
    }

    void ensureInitialized()
      .then(async () => {
        if (!enabled) {
          return;
        }
        if (unsupported) {
          if (redirectedRecently(tabId)) {
            await safeSetStatus(
              tabId,
              "ERR",
              "Repeated unsupported-country redirect was stopped."
            );
            return;
          }
          markUnsupportedRedirect(tabId);
          await startSession(tabId, FLOW_HOME);
          return;
        }
        await startSession(tabId, url);
      })
      .catch(async (error) => {
        await safeSetStatus(tabId, "ERR", errorMessage(error));
      });
  },
  { url: [{ schemes: ["https"], hostEquals: FLOW_HOST }] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (changes[STORAGE_KEYS.ENABLED]) {
    enabled = changes[STORAGE_KEYS.ENABLED].newValue !== false;
    if (!enabled) {
      void stopAllSessions().then(() => safeSetStatus(undefined, "OFF"));
    } else {
      void safeSetStatus(undefined, "ON");
    }
  }
  if (changes[STORAGE_KEYS.FLOW_PATCH_FORCED_CALLEE]) {
    void syncForcedCallee();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureInitialized();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureInitialized();
});
