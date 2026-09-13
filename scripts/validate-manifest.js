#!/usr/bin/env node
/**
 * Validate manifest.json and keep it in sync with package.json.
 * Replaces the broken `node -c manifest.json` script.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
    return null;
  }
}

const manifest = readJson('manifest.json');
const packageJson = readJson('package.json');

if (manifest) {
  for (const key of ['manifest_version', 'name', 'version', 'background', 'action']) {
    if (!(key in manifest)) errors.push(`manifest.json: missing required key "${key}"`);
  }

  if (manifest.manifest_version !== 3) {
    errors.push(`manifest.json: expected manifest_version 3, got ${manifest.manifest_version}`);
  }

  if (manifest.background?.type !== 'module') {
    warnings.push('manifest.json: background.type is not "module" although sources use ESM');
  }

  const referenced = [
    manifest.background?.service_worker,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {})
  ].filter(Boolean);

  for (const file of referenced) {
    try {
      readFileSync(join(root, file));
    } catch {
      errors.push(`manifest.json: referenced file "${file}" does not exist`);
    }
  }

  for (const permission of manifest.permissions ?? []) {
    if (permission === '<all_urls>') {
      warnings.push('manifest.json: permission "<all_urls>" is broader than needed');
    }
  }

  if (Array.isArray(manifest.optional_permissions) && manifest.optional_permissions.length === 0) {
    warnings.push('manifest.json: optional_permissions is an empty array - remove it');
  }

  if (manifest.homepage_url?.includes('your-org')) {
    warnings.push('manifest.json: homepage_url is still the placeholder "your-org"');
  }
}

if (manifest && packageJson && manifest.version !== packageJson.version) {
  errors.push(
    `version mismatch: manifest.json is ${manifest.version}, package.json is ${packageJson.version}`
  );
}

for (const warning of warnings) console.warn(`WARN  ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);

if (errors.length > 0) {
  console.error(`\nManifest validation failed (${errors.length} error(s)).`);
  process.exit(1);
}

console.log(`Manifest valid: ${manifest.name} v${manifest.version}`);
