// Flow Local Test Runner - Security Utilities Module
// Version 4.0.0

import { MAX_BUNDLE_SIZE_BYTES, FLOW_HOST } from './config.js';

/**
 * Validate URL for security
 * @param {string} url - URL to validate
 * @returns {{valid: boolean, reason?: string}} Validation result
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL is empty or invalid' };
  }

  try {
    const parsed = new URL(url);
    
    // Must be HTTPS
    if (parsed.protocol !== 'https:') {
      return { valid: false, reason: 'URL must use HTTPS' };
    }

    // Check for Flow host
    if (parsed.hostname !== FLOW_HOST && parsed.hostname !== 'www.gstatic.com') {
      return { valid: false, reason: `URL host ${parsed.hostname} is not allowed` };
    }

    // Check for path traversal attempts
    if (url.includes('..') || url.includes('\\')) {
      return { valid: false, reason: 'URL contains suspicious patterns' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, reason: `URL parsing failed: ${error.message}` };
  }
}

/**
 * Validate response body size
 * @param {number} byteLength - Size in bytes
 * @returns {{valid: boolean, reason?: string}} Validation result
 */
export function validateBundleSize(byteLength) {
  if (typeof byteLength !== 'number' || byteLength < 0 || !Number.isFinite(byteLength)) {
    return { valid: false, reason: 'Invalid byte length' };
  }

  if (byteLength > MAX_BUNDLE_SIZE_BYTES) {
    return { 
      valid: false, 
      reason: `Bundle size ${byteLength} exceeds limit of ${MAX_BUNDLE_SIZE_BYTES} bytes` 
    };
  }

  return { valid: true };
}

/**
 * Check if running in incognito mode
 * @param {number} tabId - Tab ID to check
 * @returns {Promise<boolean>} True if incognito
 */
export async function isIncognitoTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.incognito === true;
  } catch {
    return false;
  }
}

/**
 * Sanitize error message for display (remove sensitive info)
 * @param {unknown} error - Error to sanitize
 * @returns {string} Sanitized error message
 */
export function sanitizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  
  // Remove potential file paths
  let sanitized = message.replace(/file:\/\/[^\s]+/g, '[REDACTED PATH]');
  
  // Remove potential internal URLs
  sanitized = sanitized.replace(/https?:\/\/[^\s]+chrome-extension[^\s]*/gi, '[REDACTED EXTENSION URL]');
  
  // Limit length
  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 500) + '...';
  }
  
  return sanitized;
}

/**
 * Validate CSP header value
 * @param {string} cspValue - CSP header value
 * @returns {boolean} True if valid
 */
export function isValidCSP(cspValue) {
  if (!cspValue || typeof cspValue !== 'string') {
    return false;
  }
  
  // Basic validation - should contain script-src and object-src
  const hasScriptSrc = /script-src\s+['"]?self['"]?/i.test(cspValue);
  const hasObjectSrc = /object-src\s+['"]?self['"]?/i.test(cspValue);
  
  return hasScriptSrc && hasObjectSrc;
}

/**
 * Create AbortController with timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {{controller: AbortController, timeoutId: number}} Controller and timeout ID
 */
export function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Operation timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  
  // Clear timeout when aborted
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
  }, { once: true });
  
  return { controller, timeoutId };
}

export default {
  validateUrl,
  validateBundleSize,
  isIncognitoTab,
  sanitizeErrorMessage,
  isValidCSP,
  createTimeoutController
};
