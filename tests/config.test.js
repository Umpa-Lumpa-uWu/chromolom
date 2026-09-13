/**
 * Flow Local Test Runner - Unit Tests for config.js and manifest consistency
 * Version 4.0.0
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = (await import('../config.js')).default;

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('config exposes every constant the runtime needs', () => {
  for (const key of [
    'FLOW_HOME', 'FLOW_HOST', 'FLOW_URL_PATTERN', 'TARGET_HOST',
    'TARGET_BUNDLE_MARKER', 'TARGET_BUNDLE_SUFFIX', 'CDP_VERSION',
    'INTERCEPT_TIMEOUT_MS', 'SUCCESS_BADGE_MS', 'UNSUPPORTED_REDIRECT_COOLDOWN_MS',
    'MAX_BUNDLE_SIZE_BYTES', 'MAX_DECODE_ATTEMPTS', 'STORAGE_KEYS', 'STATUS',
    'UNSUPPORTED_COUNTRY_PATTERN', 'AGE_RESTRICTED_PATTERN', 'STRATEGIES'
  ]) {
    assert.ok(key in CONFIG, `${key} missing from CONFIG`);
  }
});

test('config is frozen against accidental mutation', () => {
  assert.ok(Object.isFrozen(CONFIG));
});

test('storage keys are unique and non-empty', () => {
  const values = Object.values(CONFIG.STORAGE_KEYS);
  assert.strictEqual(new Set(values).size, values.length, 'keys must be unique');
  for (const value of values) {
    assert.ok(typeof value === 'string' && value.length > 0);
  }
});

test('status definitions are complete', () => {
  for (const name of ['OFF', 'ON', 'RUN', 'OK', 'ERR']) {
    const status = CONFIG.STATUS[name];
    assert.ok(status, `${name} missing`);
    assert.ok(status.text && status.color && status.title, `${name} incomplete`);
    assert.match(status.color, /^#[0-9a-f]{6}$/i, `${name} color must be hex`);
  }
});

test('url patterns behave as documented', () => {
  assert.ok(CONFIG.FLOW_URL_PATTERN.test('https://flow.google.com/'));
  assert.ok(!CONFIG.FLOW_URL_PATTERN.test('https://flow.google.com.evil.com/'));
  assert.ok(!CONFIG.FLOW_URL_PATTERN.test('http://flow.google.com/'));

  assert.ok(CONFIG.UNSUPPORTED_COUNTRY_PATTERN.test('/unsupported-country'));
  assert.ok(CONFIG.UNSUPPORTED_COUNTRY_PATTERN.test('/unsupported-country/'));
  assert.ok(!CONFIG.UNSUPPORTED_COUNTRY_PATTERN.test('/unsupported-country/extra'));
});

test('manifest and package.json versions stay in sync', () => {
  assert.strictEqual(
    manifest.version,
    packageJson.version,
    'manifest.json and package.json must carry the same version'
  );
});

test('every file referenced by the manifest exists', () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.options_ui.page,
    ...Object.values(manifest.icons)
  ];
  for (const file of referenced) {
    assert.doesNotThrow(
      () => readFileSync(join(root, file)),
      `${file} is referenced by manifest.json but missing`
    );
  }
});
