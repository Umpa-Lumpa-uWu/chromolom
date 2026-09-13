// Flow Local Test Runner - Bundle Patching Module
// Version 4.0.0
//
// Pure ESM module: no globals, no side effects on import.
// Every strategy is exported so it can be unit tested in isolation.

import { STRATEGIES, STORAGE_KEYS } from "./config.js";

// Regexes are stored as sources and compiled on demand.
// Shared /g regexes accumulate `lastIndex` state, which silently breaks
// matching if a reset is forgotten somewhere.
const EXACT_REGION_FLAG_SOURCE = String.raw`_\.(?:uu|pu)\(a,\s*(?:31|0[xX]1[fF])\)`;
const EXACT_AGE_FLAG_SOURCE = String.raw`_\.(?:uu|pu)\(a,\s*(?:32|0[xX]20)\)`;

const REGION_FLAG_SOURCE = String.raw`31|0[xX]1[fF]`;
const AGE_FLAG_SOURCE = String.raw`32|0[xX]20`;

const DIRECT_CALL_SOURCE = String.raw`((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*\(\s*[^,()]+?\s*,\s*(31|32|0[xX]1[fF]|0[xX]20)\s*\)`;
const INDIRECT_CALL_SOURCE = String.raw`\(0,\s*((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*\)\s*\(\s*[^,()]+?\s*,\s*(31|32|0[xX]1[fF]|0[xX]20)\s*\)`;

const COUNTRY_GUARD_SOURCE = String.raw`if\s*\(\s*!\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)\s*\)(?=\s*(?:\{\s*)?return[^;]{0,256}?["']\/unsupported-country["'])`;
const AGE_GUARD_SOURCE = String.raw`if\s*\(\s*!\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)\s*\)(?=\s*(?:\{\s*)?return[^;]{0,256}?["']\/age-restricted["'])`;

const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return",
  "typeof", "new", "delete", "void", "in", "of", "do", "else",
  "case", "throw", "instanceof", "with", "yield", "await"
]);

const PREFERRED_CALLEE_PATTERN = /(^|\.)(?:uu|pu)$/;

function globalRegExp(source) {
  return new RegExp(source, "g");
}

function result(ok, source, strategy, error = null) {
  return { ok, source, strategy, error };
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeFlag(value) {
  const normalized = String(value).toLowerCase();
  if (normalized === "31" || normalized === "0x1f") return 31;
  if (normalized === "32" || normalized === "0x20") return 32;
  return null;
}

export function isKeywordCallee(callee) {
  const lastPart = callee.split(".").pop();
  return KEYWORDS.has(lastPart);
}

export function countPattern(patternSource, source) {
  return (source.match(globalRegExp(patternSource)) || []).length;
}

function countPatterns(patternSources, source) {
  return patternSources.reduce(
    (sum, patternSource) => sum + countPattern(patternSource, source),
    0
  );
}

function replacePatterns(source, patternSources, replacement) {
  return patternSources.reduce(
    (current, patternSource) =>
      current.replace(globalRegExp(patternSource), replacement),
    source
  );
}

export function makeCallPatterns(callee, flagSource) {
  const escapedCallee = escapeRegExp(callee);
  const argPattern = String.raw`\s*[^,()]+?\s*`;

  return [
    String.raw`${escapedCallee}\s*\(\s*` + argPattern + String.raw`,\s*(?:${flagSource})\s*\)`,
    String.raw`\(0,\s*${escapedCallee}\s*\)\s*\(\s*` + argPattern + String.raw`,\s*(?:${flagSource})\s*\)`
  ];
}

export function collectCandidates(source) {
  const candidates = new Map();

  const addMatches = (patternSource) => {
    for (const match of source.matchAll(globalRegExp(patternSource))) {
      const callee = match[1];
      const flag = normalizeFlag(match[2]);
      if (!callee || !flag || isKeywordCallee(callee)) continue;

      const entry = candidates.get(callee) || {
        count31: 0,
        count32: 0,
        example31: null,
        example32: null
      };

      if (flag === 31) {
        entry.count31 += 1;
        entry.example31 = entry.example31 || match[0];
      } else {
        entry.count32 += 1;
        entry.example32 = entry.example32 || match[0];
      }

      candidates.set(callee, entry);
    }
  };

  addMatches(DIRECT_CALL_SOURCE);
  addMatches(INDIRECT_CALL_SOURCE);
  return candidates;
}

export function summarize(candidates, limit = 8) {
  return [...candidates.entries()]
    .filter(([, entry]) => entry.count31 > 0 || entry.count32 > 0)
    .slice(0, limit)
    .map(
      ([callee, entry]) =>
        `${callee}:{31:${entry.count31},32:${entry.count32}}`
    )
    .join("; ");
}

export function routeGuardInfo(source) {
  return {
    countryMatches: countPattern(COUNTRY_GUARD_SOURCE, source),
    ageMatches: countPattern(AGE_GUARD_SOURCE, source)
  };
}

function getContexts(source, patternSource, limit = 5, radius = 140, flags = "g") {
  const contexts = [];
  for (const match of source.matchAll(new RegExp(patternSource, flags))) {
    const start = Math.max(0, match.index - radius);
    const end = Math.min(source.length, match.index + radius);
    contexts.push(source.slice(start, end));
    if (contexts.length >= limit) break;
  }
  return contexts;
}

function buildDiagnostics(source, reason, candidates, strategyErrors = {}, guards = null) {
  return {
    at: new Date().toISOString(),
    reason,
    strategyErrors,
    routeGuard: guards || routeGuardInfo(source),
    candidates: [...candidates.entries()].slice(0, 30).map(
      ([callee, entry]) => ({
        callee,
        count31: entry.count31,
        count32: entry.count32,
        example31: entry.example31,
        example32: entry.example32
      })
    ),
    contexts31: getContexts(source, REGION_FLAG_SOURCE, 5, 140),
    contexts32: getContexts(source, AGE_FLAG_SOURCE, 5, 140),
    unsupportedCountry: getContexts(source, String.raw`unsupported-country`, 5, 140, "gi"),
    ageRestricted: getContexts(source, String.raw`age-restricted`, 5, 140, "gi")
  };
}

// Storage access is best-effort: patching must never throw because of it.
function saveDiagnostics(diagnostics) {
  try {
    const storage = globalThis.chrome?.storage?.local;
    const maybePromise = storage?.set?.({
      [STORAGE_KEYS.FLOW_PATCH_DIAGNOSTICS]: diagnostics
    });
    if (maybePromise?.catch) maybePromise.catch(() => {});
  } catch {}
}

function logDiagnostics(diagnostics) {
  try {
    console.error("[FlowPatch]", diagnostics.reason);
    console.error("[FlowPatch] strategy errors:", diagnostics.strategyErrors);
    console.error("[FlowPatch] routeGuard:", diagnostics.routeGuard);
    console.error("[FlowPatch] candidates:", diagnostics.candidates);
    if (diagnostics.contexts31.length) {
      console.error("[FlowPatch] 31 contexts:", diagnostics.contexts31);
    }
    if (diagnostics.contexts32.length) {
      console.error("[FlowPatch] 32 contexts:", diagnostics.contexts32);
    }
    if (diagnostics.unsupportedCountry.length) {
      console.error("[FlowPatch] unsupported-country contexts:", diagnostics.unsupportedCountry);
    }
    if (diagnostics.ageRestricted.length) {
      console.error("[FlowPatch] age-restricted contexts:", diagnostics.ageRestricted);
    }
  } catch {}
}

function success(source, strategy) {
  try {
    const storage = globalThis.chrome?.storage?.local;
    const maybePromise = storage?.remove?.(STORAGE_KEYS.FLOW_PATCH_DIAGNOSTICS);
    if (maybePromise?.catch) maybePromise.catch(() => {});
  } catch {}
  return result(true, source, strategy);
}

export function patchExactKnownAccessor(source) {
  const regionCount = countPattern(EXACT_REGION_FLAG_SOURCE, source);
  const ageCount = countPattern(EXACT_AGE_FLAG_SOURCE, source);

  if (regionCount === 1 && ageCount === 1) {
    return success(
      source.replace(globalRegExp(EXACT_REGION_FLAG_SOURCE), "true"),
      STRATEGIES.EXACT_ACCESSOR
    );
  }

  return result(
    false, source, null,
    `Exact accessor not unique (region=${regionCount}, age=${ageCount}).`
  );
}

export function patchForcedCallee(source, forcedCallee) {
  if (typeof forcedCallee !== "string" || !forcedCallee.trim()) {
    return result(false, source, null, "No forced callee configured.");
  }

  const callee = forcedCallee.trim();
  const regionPatterns = makeCallPatterns(callee, REGION_FLAG_SOURCE);
  const regionCount = countPatterns(regionPatterns, source);

  if (regionCount === 1) {
    return success(
      replacePatterns(source, regionPatterns, "true"),
      STRATEGIES.FORCED_CALLEE
    );
  }

  return result(
    false, source, null,
    `Forced callee ${callee} matched ${regionCount} expressions.`
  );
}

export function patchAdaptiveCall(source, candidates) {
  const goodCandidates = [...candidates.entries()].filter(
    ([, entry]) => entry.count31 === 1 && entry.count32 === 1
  );

  const preferredCandidates = goodCandidates.filter(([callee]) =>
    PREFERRED_CALLEE_PATTERN.test(callee)
  );

  const selectedList =
    preferredCandidates.length === 1 ? preferredCandidates : goodCandidates;

  if (selectedList.length === 1) {
    const [callee] = selectedList[0];
    const regionPatterns = makeCallPatterns(callee, REGION_FLAG_SOURCE);
    const agePatterns = makeCallPatterns(callee, AGE_FLAG_SOURCE);
    const regionCount = countPatterns(regionPatterns, source);
    const ageCount = countPatterns(agePatterns, source);

    if (regionCount === 1 && ageCount === 1) {
      return success(
        replacePatterns(source, regionPatterns, "true"),
        STRATEGIES.ADAPTIVE_CALL
      );
    }

    return result(
      false, source, null,
      `Adaptive candidate ${callee} recount failed (region=${regionCount}, age=${ageCount}).`
    );
  }

  return result(
    false, source, null,
    `Adaptive call not unique (good=${goodCandidates.length}, preferred=${preferredCandidates.length}).`
  );
}

export function patchRouteGuard(source) {
  const guards = routeGuardInfo(source);

  if (guards.countryMatches === 1 && guards.ageMatches === 1) {
    const patchedSource = source.replace(
      globalRegExp(COUNTRY_GUARD_SOURCE),
      "if(($1(),false))"
    );

    const remainingCountry = countPattern(COUNTRY_GUARD_SOURCE, patchedSource);
    const remainingAge = countPattern(AGE_GUARD_SOURCE, patchedSource);

    if (remainingCountry === 0 && remainingAge === 1) {
      return success(patchedSource, STRATEGIES.ROUTE_GUARD);
    }

    return result(
      false, source, null,
      `Route guard verification failed (country=${remainingCountry}, age=${remainingAge}).`
    );
  }

  return result(
    false, source, null,
    `Route guard not unique (country=${guards.countryMatches}, age=${guards.ageMatches}).`
  );
}

export function patchSingle31(source, candidates) {
  let total31 = 0;
  let single31Callee = null;

  for (const [callee, entry] of candidates.entries()) {
    if (entry.count31 > 0) {
      total31 += entry.count31;
      single31Callee =
        entry.count31 === 1 && total31 === 1 ? callee : null;
    }
  }

  if (total31 === 1 && single31Callee) {
    const regionPatterns = makeCallPatterns(single31Callee, REGION_FLAG_SOURCE);
    if (countPatterns(regionPatterns, source) === 1) {
      return success(
        replacePatterns(source, regionPatterns, "true"),
        STRATEGIES.SINGLE_31
      );
    }
  }

  return result(
    false, source, null,
    `Single 31 candidate not found (total31=${total31}).`
  );
}

/**
 * Apply the first patch strategy that matches the bundle source.
 *
 * @param {string} source - Bundle source text.
 * @param {{forcedCallee?: string}} [options] - Optional forced callee override.
 * @returns {{ok: boolean, source: string, strategy: string|null, error: string|null}}
 */
export function patchSource(source, options = {}) {
  if (typeof source !== "string" || source.length === 0) {
    return result(false, source, null, "Bundle source is empty or invalid.");
  }

  const exactResult = patchExactKnownAccessor(source);
  if (exactResult.ok) return exactResult;

  const forcedResult = patchForcedCallee(source, options.forcedCallee);
  if (forcedResult.ok) return forcedResult;

  const candidates = collectCandidates(source);

  const adaptiveResult = patchAdaptiveCall(source, candidates);
  if (adaptiveResult.ok) return adaptiveResult;

  const routeGuardResult = patchRouteGuard(source);
  if (routeGuardResult.ok) return routeGuardResult;

  const single31Result = patchSingle31(source, candidates);
  if (single31Result.ok) return single31Result;

  const guards = routeGuardInfo(source);
  const reason =
    "No patch strategy succeeded. " +
    `routeGuard country=${guards.countryMatches}, age=${guards.ageMatches}; ` +
    `candidates: ${summarize(candidates, 5) || "none"}.`;

  const strategyErrors = {
    exact: exactResult.error,
    forced: forcedResult.error,
    adaptive: adaptiveResult.error,
    routeGuard: routeGuardResult.error,
    single31: single31Result.error
  };

  const diagnostics = buildDiagnostics(source, reason, candidates, strategyErrors, guards);

  saveDiagnostics(diagnostics);
  logDiagnostics(diagnostics);

  return result(false, source, null, reason);
}

export default { patchSource };
