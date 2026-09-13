const $ = (id) => document.getElementById(id);

// Keep the displayed version in sync with manifest.json automatically.
$("version").textContent = `Version ${chrome.runtime.getManifest().version}`;

async function refresh() {
  const data = await chrome.storage.local.get([
    "enabled",
    "lastError",
    "lastRunAt",
    "lastPatchedUrl",
    "lastPatchStrategy",
    "flowPatchDiagnostics",
    "flowPatchForcedCallee",
    "flowMetrics"
  ]);

  const isOn = data.enabled !== false;

  $("enabled-toggle").checked = isOn;
  $("mode-value").textContent = isOn ? "Auto mode is ON" : "Auto mode is OFF";
  $("mode-value").className = "mode " + (isOn ? "on" : "off");

  $("last-run").textContent = data.lastRunAt
    ? new Date(data.lastRunAt).toLocaleString()
    : "—";

  $("last-status").textContent = data.lastError
    ? "Error"
    : data.lastPatchedUrl
      ? "Patched"
      : "—";

  $("last-url").textContent = data.lastPatchedUrl || "—";
  $("last-strategy").textContent = data.lastPatchStrategy || "—";
  $("last-error").textContent = data.lastError || "No errors";
  $("forced-callee").value = data.flowPatchForcedCallee || "";

  const metrics = data.flowMetrics;
  $("metrics-output").textContent = metrics
    ? [
        `attempts:        ${metrics.totalAttempts ?? 0}`,
        `successful:      ${metrics.successfulPatches ?? 0}`,
        `failed:          ${metrics.failedPatches ?? 0}`,
        `success rate:    ${metrics.successRate ?? 0}%`,
        `avg patch time:  ${metrics.avgProcessingTimeMs ?? 0} ms`,
        `strategies:      ${
          Object.entries(metrics.strategyUsage || {})
            .map(([name, count]) => `${name}=${count}`)
            .join(", ") || "none"
        }`,
        `persisted at:    ${metrics.persistedAt ? new Date(metrics.persistedAt).toLocaleString() : "—"}`
      ].join("\n")
    : "No metrics recorded yet.";

  $("diagnostics-output").textContent = data.flowPatchDiagnostics
    ? JSON.stringify(data.flowPatchDiagnostics, null, 2)
    : "No diagnostics saved.";
}

function safeRefresh() {
  refresh().catch((error) => {
    console.error("[FlowStatus] refresh failed:", error);
  });
}

$("enabled-toggle").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ enabled: event.target.checked });
});

$("save-forced").addEventListener("click", async () => {
  const value = $("forced-callee").value.trim();
  await chrome.storage.local.set({ flowPatchForcedCallee: value || null });
  await safeRefresh();
});

$("clear-forced").addEventListener("click", async () => {
  await chrome.storage.local.remove("flowPatchForcedCallee");
  $("forced-callee").value = "";
  await safeRefresh();
});

$("copy-diagnostics").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("flowPatchDiagnostics");
  const text = data.flowPatchDiagnostics
    ? JSON.stringify(data.flowPatchDiagnostics, null, 2)
    : "";
  try {
    await navigator.clipboard.writeText(text);
    $("diagnostics-output").textContent =
      "Copied to clipboard.\n\n" + (text || "(empty)");
  } catch {
    $("diagnostics-output").textContent = text || "(empty)";
  }
});

$("clear-diagnostics").addEventListener("click", async () => {
  await chrome.storage.local.remove("flowPatchDiagnostics");
  await safeRefresh();
});

$("refresh").addEventListener("click", () => safeRefresh());

safeRefresh();

chrome.storage.onChanged.addListener(() => safeRefresh());
