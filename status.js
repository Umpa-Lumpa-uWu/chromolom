const $ = (id) => document.getElementById(id);

async function refresh() {
  const data = await chrome.storage.local.get([
    "enabled",
    "lastError",
    "lastRunAt",
    "lastPatchedUrl",
    "lastPatchStrategy",
    "flowPatchDiagnostics",
    "flowPatchForcedCallee"
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

  $("diagnostics-output").textContent = data.flowPatchDiagnostics
    ? JSON.stringify(data.flowPatchDiagnostics, null, 2)
    : "No diagnostics saved.";
}

$("enabled-toggle").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ enabled: event.target.checked });
});

$("save-forced").addEventListener("click", async () => {
  const value = $("forced-callee").value.trim();
  await chrome.storage.local.set({ flowPatchForcedCallee: value || null });
  await refresh();
});

$("clear-forced").addEventListener("click", async () => {
  await chrome.storage.local.remove("flowPatchForcedCallee");
  $("forced-callee").value = "";
  await refresh();
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
  await refresh();
});

$("refresh").addEventListener("click", () => refresh());

refresh();

chrome.storage.onChanged.addListener(() => refresh());