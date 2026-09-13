#!/usr/bin/env node
/**
 * Dependency-free syntax check for every .js file in the extension.
 * Prints CRLF/whitespace hygiene warnings too, so `npm run lint` is honest
 * instead of `echo "Linting not configured yet"`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', '.github']);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (skip.has(entry)) return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

const files = walk(root);
let errors = 0;
const warnings = [];

for (const file of files) {
  const relativePath = relative(root, file);

  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    errors += 1;
    console.error(`ERROR ${relativePath}: ${String(error.stderr || error.message).trim()}`);
    continue;
  }

  const content = readFileSync(file, 'utf8');
  if (content.includes('\r\n')) {
    warnings.push(`${relativePath}: CRLF line endings (project uses LF)`);
  }
  if (content.length > 0 && !content.endsWith('\n')) {
    warnings.push(`${relativePath}: missing trailing newline`);
  }
  if (/\t/.test(content)) {
    warnings.push(`${relativePath}: contains tab indentation`);
  }
}

for (const warning of warnings) console.warn(`WARN  ${warning}`);

if (errors > 0) {
  console.error(`\nSyntax check failed (${errors} file(s)).`);
  process.exit(1);
}

console.log(`Syntax OK: ${files.length} file(s), ${warnings.length} hygiene warning(s).`);
