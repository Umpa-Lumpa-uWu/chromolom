# Changelog

All notable changes to Flow Local Test Runner will be documented in this file.

## [Unreleased]

### 🐛 Fixed

#### Test infrastructure
- **`npm test` ran only 8 of 17 tests**: `node --experimental-vm-modules tests/*.test.js`
  treats only the first file as an entry point; the rest landed in `argv`.
  Switched to `node --test tests/*.test.js` — all test files now execute (43 tests).
- **`npm run validate` was broken**: `node -c` is not a valid flag (`SyntaxError:
  Unexpected token ':'`). Replaced with `scripts/validate-manifest.js`, which also
  checks that all manifest-referenced files exist and that `manifest.json` and
  `package.json` versions match.
- **`npm run lint` was a stub** (`echo "Linting not configured yet"`). Replaced with
  `scripts/check-syntax.js`: `node --check` on every `.js` file plus CRLF /
  trailing-newline / tab hygiene checks. No dependencies required.
- **`tests/patch.test.js` did not test `patch.js`**: 6 of 8 tests re-implemented the
  logic inline and asserted constants against themselves (`assert.strictEqual(31, 31)`).
  Rewritten with real coverage for all five patch strategies (20 tests).

#### Dead code from 4.0.0
- **`config.js`, `security.js` and `metrics.js` were never imported** — none of the
  security checks announced in 4.0.0 actually ran, and all constants were duplicated
  in `background.js`. Now wired in:
  - `validateBundleSize()` runs **before** the bundle is decoded (5 MB limit);
  - `validateUrl()` rejects bundle URLs outside the HTTPS allowlist;
  - `sanitizeErrorMessage()` is applied to everything written to storage or shown
    in the badge tooltip (previously the raw `error.message` was exposed);
  - `metricsTracker` records every attempt and persists it.

#### Architecture
- **`patch.js` no longer installs `FlowPatch` on `globalThis`** — it is a plain ESM
  module with named exports. The forced callee is passed as
  `patchSource(source, { forcedCallee })` instead of through the hidden
  `__flowPatchForceCallee` global.
- **Shared `/g` regexes removed**: patterns are stored as sources and compiled per
  call, so a leaked `lastIndex` can no longer silently skip a match.
- **Removed unreachable `_execute_action` branch** in `commands.onCommand` — reserved
  commands dispatch `chrome.action.onClicked`, never `commands.onCommand`.
- **Idempotent initialization**: `ensureInitialized()` replaces three separate
  `initializeEnabledState()` calls that clobbered the per-tab badge of running sessions.
- Extracted `recordFailure()` — removed three copies of the same error-writing block.

### 🚀 Added
- `tests/metrics.test.js` (9 tests) and `tests/config.test.js` (6 tests).
- `npm run check` (lint + validate + test) and `.github/workflows/ci.yml`
  running on Node 18/20/22.
- **Metrics section on the status page**: attempts, success rate, average patch time
  and per-strategy usage.
- Status page version is now read from the manifest instead of being hard-coded
  (it was stuck at "3.1.0" while the extension was 4.0.0).
- `.editorconfig` and a real `.gitignore` (the old one was prose, not patterns).

### 🔧 Changed
- All source files normalised to LF with trailing newlines.

---

## [4.0.0] - 2024

### 🚀 Added

#### Security Enhancements
- **Content Security Policy (CSP)**: Added strict CSP in manifest to prevent XSS attacks
- **URL Validation**: Comprehensive URL validation with HTTPS enforcement and host whitelisting
- **Bundle Size Limits**: Maximum bundle size validation (5MB limit) to prevent DoS
- **Incognito Mode Detection**: Check for incognito tabs before processing
- **Error Message Sanitization**: Remove sensitive paths and URLs from error messages
- **Timeout Controls**: AbortController-based timeouts for all async operations

#### Monitoring & Metrics
- **MetricsTracker class**: Track success rates, strategy usage, and processing times
- **Persistent metrics**: Store and retrieve historical performance data
- **Strategy analytics**: Monitor which patch strategies are most effective
- **Error tracking**: Record last error with timestamp

#### Code Quality
- **Configuration module** (`config.js`): Centralized constants and settings
- **Security module** (`security.js`): Reusable security utilities
- **Metrics module** (`metrics.js`): Performance monitoring
- **ES Modules**: Converted to ES6 modules for better maintainability
- **Unit tests**: Jest-style tests for patch and security modules
- **Package.json**: NPM scripts for testing and validation

#### Developer Experience
- **Icons**: Added placeholder icons (16x16, 48x48, 128x128)
- **Homepage URL**: Link to project repository
- **Optional permissions**: declarativeNetRequest for future enhancements
- **Test framework**: Node.js native test runner setup

### 🔧 Changed

#### Manifest Updates
- Version bumped to 4.0.0
- Added `type: "module"` for ES6 module support
- Enhanced description with security features
- Added icon references
- Added content_security_policy

#### Code Improvements
- Extracted magic numbers to named constants
- Removed empty catch blocks with proper error handling
- Improved variable naming with destructuring
- Better separation of concerns

### 📖 Documentation

- Enhanced README with troubleshooting section
- Architecture diagram
- API documentation for new modules
- Testing guide
- Security best practices

### 🐛 Fixed

- Proper cleanup of timeout IDs
- Memory leak prevention in metrics collection
- Race conditions in session management

---

## [3.1.0] - Previous Version

### Features
- Persistent adaptive local toggle
- Multiple patch strategies (exact, forced callee, adaptive, route guard)
- Automatic mode with state persistence
- Status page with diagnostics
- Hotkey support (Alt+Shift+F, Alt+Shift+S)
- Unsupported country redirect handling

---

## Migration Guide (3.x → 4.0)

### Breaking Changes
None - all existing functionality is preserved.

### New Requirements
- Chrome 100+ (unchanged)
- Icons folder with PNG files (provided)

### Recommended Steps
1. Back up your current extension data
2. Replace all files with new versions
3. Reload extension in chrome://extensions
4. Verify settings are preserved
5. Check metrics on status page

---

## Future Roadmap

- [ ] Dark theme for status page
- [ ] ARIA accessibility improvements  
- [ ] More comprehensive test coverage
- [ ] CI/CD pipeline integration
- [ ] Automated icon generation
- [ ] Plugin architecture for patch strategies
