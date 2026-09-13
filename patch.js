(function initializeFlowPatch(globalScope) {
  const EXACT_REGION_FLAG_PATTERN =
    /_\.(?:uu|pu)\(a,\s*(?:31|0[xX]1[fF])\)/g;

  const EXACT_AGE_FLAG_PATTERN =
    /_\.(?:uu|pu)\(a,\s*(?:32|0[xX]20)\)/g;

  const REGION_FLAG_PATTERN_STRING = "31|0[xX]1[fF]";
  const AGE_FLAG_PATTERN_STRING = "32|0[xX]20";

  const DIRECT_CALL_PATTERN =
    /((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*\(\s*[^,()]+?\s*,\s*(31|32|0[xX]1[fF]|0[xX]20)\s*\)/g;

  const INDIRECT_CALL_PATTERN =
    /\(0,\s*((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*\)\s*\(\s*[^,()]+?\s*,\s*(31|32|0[xX]1[fF]|0[xX]20)\s*\)/g;

  const COUNTRY_GUARD_PATTERN =
    /if\s*\(\s*!\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)\s*\)(?=\s*(?:\{\s*)?return[^;]{0,256}?["']\/unsupported-country["'])/g;

  const AGE_GUARD_PATTERN =
    /if\s*\(\s*!\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)\s*\)(?=\s*(?:\{\s*)?return[^;]{0,256}?["']\/age-restricted["'])/g;

  const KEYWORDS = new Set([
    "if", "for", "while", "switch", "catch", "function", "return",
    "typeof", "new", "delete", "void", "in", "of", "do", "else",
    "case", "throw", "instanceof", "with", "yield", "await"
  ]);

  function result(ok, source, strategy, error = null) {
    return { ok, source, strategy, error };
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeFlag(value) {
    const normalized = String(value).toLowerCase();
    if (normalized === "31" || normalized === "0x1f") return 31;
    if (normalized === "32" || normalized === "0x20") return 32;
    return null;
  }

  function isKeywordCallee(callee) {
    const lastPart = callee.split(".").pop();
    return KEYWORDS.has(lastPart);
  }

  function countPattern(pattern, source) {
    pattern.lastIndex = 0;
    const count = (source.match(pattern) || []).length;
    pattern.lastIndex = 0;
    return count;
  }

  function countPatterns(patterns, source) {
    return patterns.reduce(
      (sum, pattern) => sum + countPattern(pattern, source),
      0
    );
  }

  function replacePatterns(source, patterns, replacement) {
    let resultSource = source;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      resultSource = resultSource.replace(pattern, replacement);
    }
    return resultSource;
  }

  function makeCallPatterns(callee, flagPatternString) {
    const escapedCallee = escapeRegExp(callee);
    const argPattern = "\\s*[^,()]+?\\s*";

    const direct = new RegExp(
      escapedCallee + "\\s*\\(" + argPattern +
        ",\\s*(?:" + flagPatternString + ")\\s*\\)",
      "g"
    );

    const indirect = new RegExp(
      "\\(0,\\s*" + escapedCallee + "\\s*\\)\\s*\\(" + argPattern +
        ",\\s*(?:" + flagPatternString + ")\\s*\\)",
      "g"
    );

    return [direct, indirect];
  }

  function collectCandidates(source) {
    const candidates = new Map();

    const addMatches = (pattern) => {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
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
      pattern.lastIndex = 0;
    };

    addMatches(DIRECT_CALL_PATTERN);
    addMatches(INDIRECT_CALL_PATTERN);
    return candidates;
  }

  function summarize(candidates, limit = 8) {
    return [...candidates.entries()]
      .filter(([, entry]) => entry.count31 > 0 || entry.count32 > 0)
      .slice(0, limit)
      .map(
        ([callee, entry]) =>
          `${callee}:{31:${entry.count31},32:${entry.count32}}`
      )
      .join("; ");
  }

  function getContexts(source, pattern, limit = 5, radius = 140) {
    const contexts = [];
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const start = Math.max(0, match.index - radius);
      const end = Math.min(source.length, match.index + radius);
      contexts.push(source.slice(start, end));
      if (contexts.length >= limit) break;
    }
    pattern.lastIndex = 0;
    return contexts;
  }

  function routeGuardInfo(source) {
    return {
      countryMatches: countPattern(COUNTRY_GUARD_PATTERN, source),
      ageMatches: countPattern(AGE_GUARD_PATTERN, source)
    };
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
      contexts31: getContexts(source, /(?:31|0[xX]1[fF])/g, 5, 140),
      contexts32: getContexts(source, /(?:32|0[xX]20)/g, 5, 140),
      unsupportedCountry: getContexts(source, /unsupported-country/gi, 5, 140),
      ageRestricted: getContexts(source, /age-restricted/gi, 5, 140)
    };
  }

  function saveDiagnostics(diagnostics) {
    try {
      const storage = globalScope.chrome?.storage?.local;
      if (storage?.set) {
        const maybePromise = storage.set({ flowPatchDiagnostics: diagnostics });
        if (maybePromise?.catch) maybePromise.catch(() => {});
      }
    } catch {}
  }

  function clearDiagnostics() {
    try {
      const storage = globalScope.chrome?.storage?.local;
      if (storage?.remove) {
        const maybePromise = storage.remove("flowPatchDiagnostics");
        if (maybePromise?.catch) maybePromise.catch(() => {});
      }
      globalScope.__lastFlowSource = null;
      globalScope.__lastFlowPatchDiagnostics = null;
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
    clearDiagnostics();
    return result(true, source, strategy);
  }

  function patchExactKnownAccessor(source) {
    const regionCount = countPattern(EXACT_REGION_FLAG_PATTERN, source);
    const ageCount = countPattern(EXACT_AGE_FLAG_PATTERN, source);

    if (regionCount === 1 && ageCount === 1) {
      EXACT_REGION_FLAG_PATTERN.lastIndex = 0;
      return success(
        source.replace(EXACT_REGION_FLAG_PATTERN, "true"),
        "known-field-accessor-exact-v2"
      );
    }

    return result(
      false, source, null,
      `Exact accessor not unique (region=${regionCount}, age=${ageCount}).`
    );
  }

  function patchForcedCallee(source) {
    const forcedCallee = globalScope.__flowPatchForceCallee;
    if (typeof forcedCallee !== "string" || !forcedCallee.trim()) {
      return result(false, source, null, "No forced callee configured.");
    }

    const callee = forcedCallee.trim();
    const regionPatterns = makeCallPatterns(callee, REGION_FLAG_PATTERN_STRING);
    const regionCount = countPatterns(regionPatterns, source);

    if (regionCount === 1) {
      return success(
        replacePatterns(source, regionPatterns, "true"),
        "forced-callee-v1"
      );
    }

    return result(
      false, source, null,
      `Forced callee ${callee} matched ${regionCount} expressions.`
    );
  }

  function patchAdaptiveCall(source, candidates) {
    const goodCandidates = [...candidates.entries()].filter(
      ([, entry]) => entry.count31 === 1 && entry.count32 === 1
    );

    const preferredCandidates = goodCandidates.filter(([callee]) =>
      /(^|\.)(?:uu|pu)$/.test(callee)
    );

    const selectedList =
      preferredCandidates.length === 1
        ? preferredCandidates
        : goodCandidates;

    if (selectedList.length === 1) {
      const [callee] = selectedList[0];
      const regionPatterns = makeCallPatterns(callee, REGION_FLAG_PATTERN_STRING);
      const agePatterns = makeCallPatterns(callee, AGE_FLAG_PATTERN_STRING);
      const regionCount = countPatterns(regionPatterns, source);
      const ageCount = countPatterns(agePatterns, source);

      if (regionCount === 1 && ageCount === 1) {
        return success(
          replacePatterns(source, regionPatterns, "true"),
          "adaptive-call-v1"
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

  function patchRouteGuard(source) {
    const guards = routeGuardInfo(source);

    if (guards.countryMatches === 1 && guards.ageMatches === 1) {
      COUNTRY_GUARD_PATTERN.lastIndex = 0;
      const patchedSource = source.replace(
        COUNTRY_GUARD_PATTERN,
        "if(($1(),false))"
      );

      const remainingCountry = countPattern(COUNTRY_GUARD_PATTERN, patchedSource);
      const remainingAge = countPattern(AGE_GUARD_PATTERN, patchedSource);

      if (remainingCountry === 0 && remainingAge === 1) {
        return success(patchedSource, "route-guard-v2");
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

  function patchSingle31(source, candidates) {
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
      const regionPatterns = makeCallPatterns(single31Callee, REGION_FLAG_PATTERN_STRING);
      if (countPatterns(regionPatterns, source) === 1) {
        return success(
          replacePatterns(source, regionPatterns, "true"),
          "adaptive-single31-v1"
        );
      }
    }

    return result(
      false, source, null,
      `Single 31 candidate not found (total31=${total31}).`
    );
  }

  function patchSource(source) {
    if (typeof source !== "string" || source.length === 0) {
      return result(false, source, null, "Bundle source is empty or invalid.");
    }

    const exactResult = patchExactKnownAccessor(source);
    if (exactResult.ok) return exactResult;

    const forcedResult = patchForcedCallee(source);
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

    try {
      globalScope.__lastFlowSource = source;
      globalScope.__lastFlowPatchDiagnostics = diagnostics;
    } catch {}

    saveDiagnostics(diagnostics);
    logDiagnostics(diagnostics);

    return result(false, source, null, reason);
  }

  globalScope.FlowPatch = Object.freeze({ patchSource });
})(globalThis);