/**
 * Flow Local Test Runner - Unit Tests for patch.js
 * Version 4.0.0
 *
 * Run with: node --test tests/patch.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';

// Minimal chrome.storage mock so diagnostics can be captured.
const storageCalls = { set: [], removed: [] };
globalThis.chrome = {
  storage: {
    local: {
      set: async (payload) => { storageCalls.set.push(payload); },
      remove: async (key) => { storageCalls.removed.push(key); }
    }
  }
};

const {
  patchSource,
  patchExactKnownAccessor,
  patchForcedCallee,
  patchAdaptiveCall,
  patchRouteGuard,
  patchSingle31,
  collectCandidates,
  routeGuardInfo,
  normalizeFlag,
  escapeRegExp,
  isKeywordCallee,
  makeCallPatterns
} = await import('../patch.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStorageCalls() {
  storageCalls.set.length = 0;
  storageCalls.removed.length = 0;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test('patchSource rejects empty and non-string input', () => {
  for (const input of ['', null, undefined, 123, {}, []]) {
    const result = patchSource(input);
    assert.strictEqual(result.ok, false, `input ${String(input)} should fail`);
    if (input === '') {
      assert.strictEqual(result.error, 'Bundle source is empty or invalid.');
    }
  }
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('normalizeFlag maps decimal and hex spellings', () => {
  assert.strictEqual(normalizeFlag('31'), 31);
  assert.strictEqual(normalizeFlag('0x1f'), 31);
  assert.strictEqual(normalizeFlag('0X1F'), 31);
  assert.strictEqual(normalizeFlag('32'), 32);
  assert.strictEqual(normalizeFlag('0x20'), 32);
  assert.strictEqual(normalizeFlag('0X20'), 32);
  assert.strictEqual(normalizeFlag('33'), null);
  assert.strictEqual(normalizeFlag('abc'), null);
});

test('escapeRegExp escapes regex metacharacters', () => {
  for (const char of ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']) {
    const escaped = escapeRegExp(char);
    assert.ok(escaped.startsWith('\\'), `${char} should be escaped`);
    assert.doesNotThrow(() => new RegExp(escaped));
  }
  assert.strictEqual(escapeRegExp('Xy.ab'), 'Xy\\.ab');
});

test('isKeywordCallee rejects reserved words, accepts real callees', () => {
  for (const keyword of ['if', 'for', 'while', 'return', 'typeof', 'new', 'await']) {
    assert.strictEqual(isKeywordCallee(keyword), true, `${keyword} is a keyword`);
  }
  for (const callee of ['_.uu', 'Xy.ab', 'checkCountry']) {
    assert.strictEqual(isKeywordCallee(callee), false, `${callee} is not a keyword`);
  }
  // The *last* segment decides, so `a.b.if` is rejected too.
  assert.strictEqual(isKeywordCallee('a.b.if'), true);
});

test('makeCallPatterns builds direct and indirect patterns', () => {
  const [directSource, indirectSource] = makeCallPatterns('Xy.ab', '31|0[xX]1[fF]');
  const direct = new RegExp(directSource);
  const indirect = new RegExp(indirectSource);

  assert.match('Xy.ab(a,31)', direct);
  assert.match('(0,Xy.ab)(a,31)', indirect);
  assert.doesNotMatch('Xy.ab(a,32)', direct);
  assert.doesNotMatch('Zz.cd(a,31)', direct);
  // A callee containing metacharacters must be treated literally.
  const [escapedSource] = makeCallPatterns('Xy.ab(', '31');
  assert.doesNotMatch('XyXabY(a,31)', new RegExp(escapedSource));
  assert.match('Xy.ab((a,31)', new RegExp(escapedSource));
});

// ---------------------------------------------------------------------------
// collectCandidates / routeGuardInfo
// ---------------------------------------------------------------------------

test('collectCandidates groups flags per callee and skips keywords', () => {
  const source = 'Xy.ab(a,31);Xy.ab(a,32);Zz.cd(a,31);if(a,31);';
  const candidates = collectCandidates(source);

  assert.deepStrictEqual(
    { count31: candidates.get('Xy.ab').count31, count32: candidates.get('Xy.ab').count32 },
    { count31: 1, count32: 1 }
  );
  assert.strictEqual(candidates.get('Zz.cd').count31, 1);
  assert.strictEqual(candidates.has('if'), false, 'keywords must be skipped');
});

test('routeGuardInfo counts country and age guards', () => {
  const source =
    'function r(){if(!checkCountry())return"/unsupported-country";if(!checkAge())return"/age-restricted";}';
  assert.deepStrictEqual(routeGuardInfo(source), { countryMatches: 1, ageMatches: 1 });

  assert.deepStrictEqual(routeGuardInfo('nothing here'), { countryMatches: 0, ageMatches: 0 });
});

// ---------------------------------------------------------------------------
// Strategy 1: known-field-accessor-exact-v2
// ---------------------------------------------------------------------------

test('exact accessor strategy patches a unique _.uu(a,31)', () => {
  const source =
    'function f(a){if(_.uu(a,31))return"/unsupported-country";if(_.uu(a,32))return"/age-restricted";return"/";}';
  const result = patchSource(source);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.strategy, 'known-field-accessor-exact-v2');
  assert.ok(result.source.includes('if(true)'));
  assert.ok(!result.source.includes('_.uu(a,31)'));
});

test('exact accessor strategy refuses ambiguous bundles', () => {
  const source = 'if(_.uu(a,31))x=1;if(_.uu(a,31))y=2;if(_.uu(a,32))z=3;';
  const result = patchExactKnownAccessor(source);

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Exact accessor not unique \(region=2, age=1\)/);
});

// ---------------------------------------------------------------------------
// Strategy 2: forced-callee-v1
// ---------------------------------------------------------------------------

test('forced callee strategy uses the configured callee', () => {
  const source = 'if(Xy.ab(a,31))return"/unsupported-country";';
  const result = patchSource(source, { forcedCallee: 'Xy.ab' });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.strategy, 'forced-callee-v1');
  assert.ok(result.source.includes('if(true)'));
});

test('forced callee strategy reports when nothing is configured', () => {
  const result = patchForcedCallee('if(Xy.ab(a,31))return 1;');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'No forced callee configured.');
});

test('forced callee strategy refuses ambiguous matches', () => {
  const result = patchForcedCallee('Xy.ab(a,31);Xy.ab(a,31);', 'Xy.ab');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /matched 2 expressions/);
});

// ---------------------------------------------------------------------------
// Strategy 3: adaptive-call-v1
// ---------------------------------------------------------------------------

test('adaptive call strategy finds a renamed callee with 31 and 32', () => {
  const source =
    'if(Aa.zz(a,31))return"/unsupported-country";if(Aa.zz(a,32))return"/age-restricted";';
  const result = patchSource(source);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.strategy, 'adaptive-call-v1');
  assert.ok(result.source.includes('if(true)'));
});

test('adaptive call strategy refuses when several candidates qualify', () => {
  const source = 'Aa.zz(a,31);Aa.zz(a,32);Bb.zz(a,31);Bb.zz(a,32);';
  const result = patchAdaptiveCall(source, collectCandidates(source));

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Adaptive call not unique \(good=2, preferred=0\)/);
});

// ---------------------------------------------------------------------------
// Strategy 4: route-guard-v2
// ---------------------------------------------------------------------------

test('route guard strategy neutralises the country guard', () => {
  const source =
    'function r(){if(!checkCountry())return"/unsupported-country";if(!checkAge())return"/age-restricted";}';
  const result = patchSource(source);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.strategy, 'route-guard-v2');
  assert.ok(result.source.includes('if((checkCountry(),false))'));
  assert.ok(result.source.includes('if(!checkAge())'), 'age guard must stay intact');
});

// ---------------------------------------------------------------------------
// Strategy 5: adaptive-single31-v1
// ---------------------------------------------------------------------------

test('single 31 strategy is the last-resort fallback', () => {
  const source = 'if(Qq.mm(a,31)){x=1;}';
  const result = patchSource(source);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.strategy, 'adaptive-single31-v1');
  assert.ok(result.source.includes('if(true)'));
});

test('single 31 strategy refuses several 31 candidates', () => {
  const source = 'Qq.mm(a,31);Rr.nn(a,31);';
  const result = patchSingle31(source, collectCandidates(source));

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /total31=2/);
});

// ---------------------------------------------------------------------------
// Failure path / diagnostics
// ---------------------------------------------------------------------------

test('total failure saves diagnostics and reports every strategy error', () => {
  resetStorageCalls();
  const source = 'var x = 1; function notAGuard() { return "/"; }';
  const result = patchSource(source);

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No patch strategy succeeded/);

  assert.strictEqual(storageCalls.set.length, 1, 'diagnostics should be saved');
  const diagnostics = storageCalls.set[0].flowPatchDiagnostics;

  assert.ok(diagnostics.at, 'diagnostics need a timestamp');
  assert.strictEqual(typeof diagnostics.reason, 'string');
  for (const key of ['exact', 'forced', 'adaptive', 'routeGuard', 'single31']) {
    assert.ok(key in diagnostics.strategyErrors, `${key} error must be reported`);
  }
  assert.deepStrictEqual(diagnostics.candidates, []);
  assert.deepStrictEqual(diagnostics.routeGuard, { countryMatches: 0, ageMatches: 0 });
});

test('successful patch clears stored diagnostics', () => {
  resetStorageCalls();
  const source =
    'function f(a){if(_.uu(a,31))return"/unsupported-country";if(_.uu(a,32))return"/age-restricted";}';

  assert.strictEqual(patchSource(source).ok, true);
  assert.deepStrictEqual(storageCalls.removed, ['flowPatchDiagnostics']);
  assert.strictEqual(storageCalls.set.length, 0, 'nothing should be saved on success');
});

test('no shared regexp state leaks between calls', () => {
  const source =
    'function f(a){if(_.uu(a,31))return"/unsupported-country";if(_.uu(a,32))return"/age-restricted";}';

  // The same bundle patched repeatedly must produce identical results;
  // a leaked `lastIndex` would make later calls silently skip matches.
  for (let i = 0; i < 5; i += 1) {
    const result = patchSource(source);
    assert.strictEqual(result.ok, true, `run ${i} should succeed`);
    assert.strictEqual(result.strategy, 'known-field-accessor-exact-v2');
  }
});
