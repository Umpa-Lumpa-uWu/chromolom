# Contributing to Flow Local Test Runner

Thank you for considering contributing! This document provides guidelines.

## 🎯 Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what's best for the community

## 📋 How to Contribute

### Reporting Bugs

1. **Check existing issues** first
2. **Create a new issue** with:
   - Clear title
   - Steps to reproduce
   - Expected vs actual behavior
   - Chrome version
   - Extension version
   - Screenshots if applicable

### Suggesting Enhancements

1. **Check existing issues** for similar requests
2. **Create an enhancement issue** with:
   - Use case description
   - Proposed solution
   - Alternatives considered

### Pull Requests

1. **Fork** the repository
2. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```
3. **Make changes** following coding standards
4. **Add tests** for new functionality
5. **Run tests**:
   ```bash
   npm test
   ```
6. **Commit** with clear messages:
   ```bash
   git commit -m "feat: add dark mode support"
   git commit -m "fix: resolve race condition in session cleanup"
   ```
7. **Push** and create PR

## 💻 Coding Standards

### JavaScript

- Use ES6+ features (modules, arrow functions, etc.)
- Prefer `const` over `let`, avoid `var`
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Example

```javascript
/**
 * Validate URL for security
 * @param {string} url - URL to validate
 * @returns {{valid: boolean, reason?: string}} Validation result
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL is empty or invalid' };
  }
  // ... implementation
}
```

### Testing

- Write unit tests for new modules
- Test edge cases and error conditions
- Maintain >80% code coverage
- Use descriptive test names

```javascript
test('validateUrl rejects non-HTTPS URLs', () => {
  const result = validateUrl('http://example.com');
  assert.strictEqual(result.valid, false);
  assert.ok(result.reason.includes('HTTPS'));
});
```

## 🔍 Review Process

1. All PRs require at least one review
2. Tests must pass
3. Code must follow standards
4. Documentation updated if needed

## 📝 Release Process

1. Update version in `manifest.json`
2. Update `CHANGELOG.md`
3. Create git tag
4. Build and test
5. Publish to Chrome Web Store

## 🙏 Thank You!

Your contributions make this extension better for everyone!
