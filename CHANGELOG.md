# Changelog

All notable changes to Flow Local Test Runner will be documented in this file.

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
