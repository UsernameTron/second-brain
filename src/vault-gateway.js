'use strict';

/**
 * vault-gateway.js
 *
 * The single write enforcement point for the Second Brain vault.
 * All vault writes and reads route through this module.
 *
 * Three-gate sequential enforcement (this plan: Guard 1 — path allowlist):
 *   Guard 1: Path allowlist — is the target path on the RIGHT side?
 *   Guard 2: Content filter — excluded terms scan + Haiku classification (Plan 02)
 *   Guard 3: Style lint — anti-AI writing style guide (Plan 02)
 *
 * Security design:
 *   - Canonical path resolution via path.resolve() against vault root
 *   - Absolute path rejection
 *   - Path traversal (..) detection and rejection
 *   - Symlink escape defense via fs.realpathSync
 *   - Case-sensitive allowlist matching (fail-safe on case-insensitive FS)
 *   - Config intersection validation (LEFT ∩ RIGHT = ∅)
 *   - Redacted quarantine: blocked content never reaches disk, metadata only
 *   - VAULT_ROOT overridable via env var for integration testing
 *
 * @module vault-gateway
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
let chokidar;
try { chokidar = require('chokidar'); } catch (_) { chokidar = null; }

// Policy modules — integrated in Plan 02
const { checkContent, sanitizeContent } = require('./content-policy');
const { checkStyle, getBannedWords, loadStyleGuide } = require('./style-policy');
const { safeLoadVaultPaths, loadExcludedTerms } = require('./pipeline-infra');

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Vault root path. Overridable via VAULT_ROOT env var for integration testing.
 * Addresses review item #6: env var override for test isolation.
 */
const VAULT_ROOT = process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');

/**
 * Config directory relative to project root (one level up from src/).
 * CONFIG_DIR_OVERRIDE allows test isolation without touching the real config.
 */
const CONFIG_DIR = process.env.CONFIG_DIR_OVERRIDE
  || path.join(__dirname, '..', 'config');

// ── Config reload event emitter ──────────────────────────────────────────────

/**
 * EventEmitter for config lifecycle events.
 * Fires 'config:reloaded' after successful hot-reload.
 * Consumers (e.g., pipeline stages) listen on this to invalidate caches.
 */
const configEvents = new EventEmitter();

// ── Error class ──────────────────────────────────────────────────────────────

/**
 * Custom error class for vault gateway violations.
 * Codes: INVALID_PATH, PATH_BLOCKED, STYLE_VIOLATION (Plan 02), CONTENT_BLOCKED (Plan 02)
 */
class VaultWriteError extends Error {
  /**
   * @param {string} message
   * @param {string} code - INVALID_PATH | PATH_BLOCKED | STYLE_VIOLATION | CONTENT_BLOCKED
   */
  constructor(message, code) {
    super(message);
    this.name = 'VaultWriteError';
    this.code = code;
  }
}

// ── Audit logging ────────────────────────────────────────────────────────────

/**
 * Write a structured JSON decision log entry to stderr.
 * Provides rollout observability without storing any content payload.
 * Addresses Codex review: observability gap.
 *
 * @param {string} action - The action being performed (WRITE, READ, QUARANTINE, etc.)
 * @param {string} filePath - The vault-relative path
 * @param {string} decision - The decision outcome (WRITTEN, BLOCKED, QUARANTINED, etc.)
 * @param {string|null} reason - Human-readable reason for non-PASS decisions
 */
function logDecision(action, filePath, decision, reason) {
  const entry = {
    ts: new Date().toISOString(),
    action,
    path: filePath,
    decision,
    ...(reason ? { reason } : {}),
  };
  // No content payload: only decision metadata reaches the log
  console.error(JSON.stringify(entry));
}

// ── Config loading, validation, and hot-reload ───────────────────────────────

/** @type {{ left: string[], right: string[], excludedTerms: string[] } | null} */
let _config = null;

/** Active chokidar watcher instance (kept for cleanup in tests) */
const _watcher = null;

/**
 * Validate config object structure and constraints.
 * Throws descriptively on any validation failure (fail closed).
 *
 * Validates:
 *   - left and right are non-empty arrays of strings
 *   - excludedTerms is a non-empty array of strings
 *   - LEFT ∩ RIGHT = ∅ (addresses review item #3 — config intersection check)
 *
 * @param {{ left: string[], right: string[], excludedTerms: string[] }} config
 * @throws {Error} On any validation failure
 */
function validateConfig(config) {
  if (!Array.isArray(config.left) || config.left.length === 0) {
    throw new Error('Config error: "left" must be a non-empty array of strings');
  }
  if (!Array.isArray(config.right) || config.right.length === 0) {
    throw new Error('Config error: "right" must be a non-empty array of strings');
  }
  if (!Array.isArray(config.excludedTerms) || config.excludedTerms.length === 0) {
    throw new Error('Config error: "excludedTerms" must be a non-empty array of strings');
  }

  // Validate all entries are strings
  for (const entry of config.left) {
    if (typeof entry !== 'string') {
      throw new Error(`Config error: "left" array must contain only strings, got: ${typeof entry}`);
    }
  }
  for (const entry of config.right) {
    if (typeof entry !== 'string') {
      throw new Error(`Config error: "right" array must contain only strings, got: ${typeof entry}`);
    }
  }

  // Intersection check: LEFT ∩ RIGHT must be empty (addresses review item #3)
  for (const entry of config.left) {
    if (config.right.includes(entry)) {
      throw new Error(
        `Config error: '${entry}' appears in both left and right arrays — ambiguous boundary`
      );
    }
  }
}

/**
 * Load, parse, and validate config via overlay-enabled loaders.
 * Uses safeLoadVaultPaths() and loadExcludedTerms() from pipeline-infra.
 * Fails closed: throws on any parse or validation error.
 *
 * @returns {{ left: string[], right: string[], excludedTerms: string[] }}
 * @throws {Error} On file read, parse, or validation failure
 */
function loadConfig() {
  // Use overlay-enabled loaders (T13.6) — supports local overrides
  const vaultPaths = safeLoadVaultPaths();
  const excludedTerms = loadExcludedTerms();

  const config = {
    left: vaultPaths.left,
    right: vaultPaths.right,
    excludedTerms,
    // Plan 02: configurable Haiku context window size (default 100 if absent)
    haikuContextChars: vaultPaths.haikuContextChars || 100,
  };

  validateConfig(config);
  return config;
}

/**
 * Return cached config, lazy-loading on first call.
 *
 * @returns {{ left: string[], right: string[], excludedTerms: string[] }}
 */
function getConfig() {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** @type {boolean} Debounce guard for config reload */
let _reloading = false;

/**
 * Internal reload handler. Debounces with 50ms to prevent macOS double-fire.
 * On parse error, keeps old config and logs warning to stderr.
 * Fires 'config:reloaded' on configEvents after successful reload.
 */
function _handleConfigChange() {
  if (_reloading) return;
  _reloading = true;
  setTimeout(() => {
    try {
      _config = loadConfig();
      configEvents.emit('config:reloaded', _config);
    } catch (e) {
      console.error(`[vault-gateway] Config reload failed: ${e.message}. Keeping previous config.`);
    }
    _reloading = false;
  }, 50);
}

/**
 * Watch a config file for changes and reload on update.
 * Uses chokidar if available (reliable on macOS), falls back to fs.watchFile.
 * Fixes D-48: fs.watch does not fire reliably on macOS in production.
 *
 * @param {string} configPath - Absolute path to config file to watch
 */
/** @type {Array} Active watchers for cleanup */
const _watchers = [];

function watchConfig(configPath) {
  if (chokidar) {
    const w = chokidar.watch(configPath, { ignoreInitial: true });
    w.on('change', _handleConfigChange);
    _watchers.push(w);
  } else {
    fs.watchFile(configPath, { interval: 500 }, _handleConfigChange);
  }
}

/**
 * Initialize the gateway: load config, start config file watchers, and
 * initialize style guide cache and watcher.
 * Called once at module load (via lazy-loading in getConfig) or explicitly.
 *
 * @returns {{ left: string[], right: string[], excludedTerms: string[] }}
 */
function initGateway() {
  _config = loadConfig();
  watchConfig(path.join(CONFIG_DIR, 'vault-paths.json'));
  watchConfig(path.join(CONFIG_DIR, 'excluded-terms.json'));
  // Initialize style guide cache and watcher (Plan 02 addition)
  loadStyleGuide();
  return _config;
}

// ── Canonical path security ──────────────────────────────────────────────────

/**
 * Normalize and validate an input path against vault security rules.
 * Applies all path security checks:
 *   1. Reject absolute paths (starts with / or path.isAbsolute)
 *   2. Normalize (..) resolution via path.normalize
 *   3. Reject remaining traversal segments (..)
 *   4. Resolve against VAULT_ROOT to verify no escape
 *
 * @param {string} inputPath - Relative vault path from caller
 * @returns {string} Normalized relative path (safe for allowlist matching)
 * @throws {VaultWriteError} With code INVALID_PATH on any security violation
 */
function normalizePath(inputPath) {
  // 1. Reject absolute paths
  if (path.isAbsolute(inputPath) || inputPath.startsWith('/')) {
    throw new VaultWriteError('Absolute paths are not allowed', 'INVALID_PATH');
  }

  // 2. Reject traversal in raw input BEFORE normalization resolves it away.
  // "memory/../ABOUT ME/secret.md" normalizes to "ABOUT ME/secret.md" — a lateral
  // traversal from RIGHT to LEFT. Checking post-normalize misses this.
  if (inputPath.includes('..')) {
    throw new VaultWriteError('Path traversal detected', 'INVALID_PATH');
  }

  // 3. Normalize: resolve . segments
  const normalized = path.normalize(inputPath);

  // 4. Resolve against vault root to verify no escape via clever path construction
  const resolvedPath = path.resolve(VAULT_ROOT, normalized);
  if (!resolvedPath.startsWith(VAULT_ROOT + path.sep) && resolvedPath !== VAULT_ROOT) {
    throw new VaultWriteError('Path escapes vault root', 'INVALID_PATH');
  }

  return normalized;
}

// ── Path guard ───────────────────────────────────────────────────────────────

/**
 * Check whether a normalized path is on the RIGHT-side allowlist.
 * Extracts the first path segment and compares case-sensitively against config.right.
 *
 * Case-sensitive match: fail-safe on case-insensitive FS (blocks 'Memory/' even though 'memory/' is allowed).
 * macOS APFS is case-insensitive (case-preserving) but this check uses exact string matching.
 * A case-variant like 'Memory/note.md' is BLOCKED — it does not match 'memory' in config.right.
 * This is intentionally fail-safe: case-variants never accidentally gain write access.
 *
 * @param {string} normalizedPath - Normalized relative vault path
 * @param {{ left: string[], right: string[], excludedTerms: string[] }} config
 * @returns {{ decision: 'PASS' } | { decision: 'BLOCK', reason: string }}
 */
function checkPath(normalizedPath, config) {
  // Extract first path segment (directory name)
  const firstSegment = normalizedPath.split('/')[0] || normalizedPath;

  // Case-sensitive match: fail-safe on case-insensitive FS (blocks 'Memory/' even though 'memory/' is allowed)
  const isRight = config.right.includes(firstSegment);
  if (!isRight) {
    return {
      decision: 'BLOCK',
      reason: `Path '${normalizedPath}' is not on the RIGHT side allowlist`,
    };
  }

  return { decision: 'PASS' };
}

// ── Vault read guard (D-04 three-tier model) ─────────────────────────────────

/**
 * Read a file from the vault.
 * Enforces three-tier access model (D-04):
 *   - LEFT paths: read allowed
 *   - RIGHT paths: read allowed
 *   - Unknown paths: BLOCKED entirely (neither read nor write)
 *
 * @param {string} relativePath - Relative path within the vault
 * @returns {Promise<string>} File contents as UTF-8 string
 * @throws {VaultWriteError} With code PATH_BLOCKED for unknown paths
 * @throws {VaultWriteError} With code INVALID_PATH for absolute/traversal paths
 */
async function vaultRead(relativePath) {
  const normalized = normalizePath(relativePath);
  const config = getConfig();

  const firstSegment = normalized.split('/')[0] || normalized;

  // Three-tier check: LEFT = read OK, RIGHT = read OK, unknown = BLOCK
  const isLeft = config.left.includes(firstSegment);
  const isRight = config.right.includes(firstSegment);

  if (!isLeft && !isRight) {
    logDecision('READ', normalized, 'BLOCKED', 'Path not in vault manifest');
    throw new VaultWriteError(
      'Path not in vault manifest — unknown paths blocked per D-04',
      'PATH_BLOCKED'
    );
  }

  const absolutePath = path.join(VAULT_ROOT, normalized);
  logDecision('READ', normalized, 'ALLOWED', null);
  return fs.promises.readFile(absolutePath, 'utf8');
}

// ── Redacted quarantine ──────────────────────────────────────────────────────

/**
 * Write a redacted metadata-only quarantine record to proposals/.
 * Stores ONLY the reason, original path, and timestamp — NO blocked content.
 * Satisfies: "excluded content never reaches disk" (review HIGH concern #2).
 *
 * @param {string} originalPath - The vault-relative path that was blocked
 * @param {string} reason - Why the content was blocked
 * @returns {Promise<{ decision: 'QUARANTINED', quarantinePath: string }>}
 */
async function quarantine(originalPath, reason) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantineFilename = `quarantine-${timestamp}.md`;
  const quarantineAbsPath = path.join(VAULT_ROOT, 'proposals', quarantineFilename);
  const quarantineRelPath = path.join('proposals', quarantineFilename);

  // Metadata-only content — no blocked content stored
  const metadata = [
    '---',
    'quarantine: true',
    `original_path: ${originalPath}`,
    `reason: ${reason}`,
    `timestamp: ${new Date().toISOString()}`,
    '---',
    '',
    'Content was blocked and not written to disk.',
    'Review the source and re-submit manually if appropriate.',
  ].join('\n');

  await fs.promises.mkdir(path.dirname(quarantineAbsPath), { recursive: true });
  await fs.promises.writeFile(quarantineAbsPath, metadata, 'utf8');

  logDecision('QUARANTINE', originalPath, 'QUARANTINED', reason);
  return { decision: 'QUARANTINED', quarantinePath: quarantineRelPath };
}

// ── Core write function ──────────────────────────────────────────────────────

/**
 * Write content to the vault through the three-gate write enforcement pipeline.
 * Plan 02: Adds Guard 2 (content filter with sanitization) and Guard 3 (style lint).
 *
 * Three gates run sequentially:
 *   1. Path guard: canonical path security + RIGHT-side allowlist
 *   2. Content filter: two-stage keyword scan + Haiku classification + sanitization
 *   3. Style lint: banned word regex check with attemptCount-driven escalation
 *
 * @param {string} relativePath - Vault-relative path (must be on RIGHT side)
 * @param {string} content - Content to write
 * @param {object} [options={}] - Options
 * @param {number} [options.attemptCount=0] - Retry count for style lint (caller-tracked)
 * @returns {Promise<{ decision: 'WRITTEN'|'QUARANTINED', path?: string, quarantinePath?: string }>}
 * @throws {VaultWriteError} With code PATH_BLOCKED if path not on RIGHT side
 * @throws {VaultWriteError} With code INVALID_PATH on path security violations
 * @throws {VaultWriteError} With code STYLE_VIOLATION on first style lint failure
 */
async function vaultWrite(relativePath, content, options = {}) {
  // Guard 1: Canonical path security + path allowlist
  const normalized = normalizePath(relativePath);
  const config = getConfig();

  const pathResult = checkPath(normalized, config);
  if (pathResult.decision === 'BLOCK') {
    logDecision('WRITE', normalized, 'BLOCKED', pathResult.reason);
    throw new VaultWriteError(pathResult.reason, 'PATH_BLOCKED');
  }

  // Guard 2: Content filter — two-stage (keyword scan + Haiku) with sanitization
  const haikuContextChars = config.haikuContextChars || 100;
  const contentResult = await checkContent(content, config.excludedTerms, haikuContextChars);

  if (contentResult.decision === 'BLOCK') {
    // Attempt paragraph-level sanitization
    const sanitizeResult = sanitizeContent(content, config.excludedTerms);
    const totalParagraphs = content.split('\n\n').length;

    if (sanitizeResult.redactedCount > totalParagraphs / 2) {
      // Content is primarily about excluded topics — quarantine (metadata only)
      logDecision('WRITE', normalized, 'QUARANTINED', contentResult.reason);
      return await quarantine(normalized, contentResult.reason);
    } else {
      // Sanitization sufficient — write redacted version
      logDecision('WRITE', normalized, 'SANITIZED', `${sanitizeResult.redactedCount} paragraph(s) redacted`);
      content = sanitizeResult.sanitized;
    }
  }

  // Guard 3: Style lint — banned word regex check
  const styleResult = checkStyle(content, getBannedWords(), options.attemptCount ?? 0);

  if (styleResult.decision === 'REJECT') {
    throw new VaultWriteError(styleResult.reason, 'STYLE_VIOLATION');
  }

  if (styleResult.decision === 'QUARANTINE') {
    logDecision('WRITE', normalized, 'QUARANTINED', styleResult.reason);
    return await quarantine(normalized, styleResult.reason);
  }

  // All guards passed — write to vault
  const absolutePath = path.join(VAULT_ROOT, normalized);

  // Create parent directory (may not exist yet)
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });

  // Symlink defense: verify resolved parent directory is still inside VAULT_ROOT
  // Only applicable when parent directory exists (realpathSync requires the path to exist)
  // Both paths resolved via realpathSync to handle OS-level symlinks (e.g., /var → /private/var on macOS)
  try {
    const realParent = fs.realpathSync(path.dirname(absolutePath));
    let realVaultRoot;
    try {
      realVaultRoot = fs.realpathSync(VAULT_ROOT);
    } catch (_) {
      realVaultRoot = VAULT_ROOT;
    }
    if (!realParent.startsWith(realVaultRoot)) {
      logDecision('WRITE', normalized, 'BLOCKED', 'Symlink escape detected');
      throw new VaultWriteError('Symlink escape detected', 'INVALID_PATH');
    }
  } catch (e) {
    // If realpathSync fails because directory doesn't exist yet, skip the check
    // (mkdir { recursive: true } may have created it but the parent could be brand new)
    if (e.code !== 'ENOENT' && e instanceof VaultWriteError) {
      throw e;
    }
    // ENOENT = directory didn't exist before mkdir — no symlink to check
  }

  // Write to vault
  await fs.promises.writeFile(absolutePath, content, 'utf8');

  logDecision('WRITE', normalized, 'WRITTEN', null);
  return { decision: 'WRITTEN', path: normalized };
}

// ── Config-driven vault bootstrap ────────────────────────────────────────────

/**
 * Create RIGHT-side vault directories if they don't exist.
 * Derives directory list from config.right — NOT from a hardcoded list.
 * Does NOT create LEFT-side directories (those are human-created per VAULT-01).
 *
 * @returns {Promise<void>}
 */
async function bootstrapVault() {
  const config = getConfig();

  // Create each RIGHT-side directory from config — config-driven, not hardcoded
  for (const dir of config.right) {
    await fs.promises.mkdir(path.join(VAULT_ROOT, dir), { recursive: true });
  }
  // LEFT side: ABOUT ME/ exists. Daily/, Relationships/, Drafts/ — human creates these.
  // Gateway does NOT create LEFT-side directories.
}

// ── Wikilink utilities ───────────────────────────────────────────────────────

/**
 * Generate a standard Obsidian wikilink.
 * Obsidian resolves wikilinks across the vault regardless of directory.
 *
 * @param {string} noteName - The note name (Obsidian resolves flat across vault)
 * @param {string} [displayText] - Optional display text for aliased links
 * @returns {string} Wikilink syntax: [[noteName]] or [[noteName|displayText]]
 */
function toWikilink(noteName, displayText) {
  return displayText ? `[[${noteName}|${displayText}]]` : `[[${noteName}]]`;
}

/**
 * Generate a path-qualified Obsidian wikilink for disambiguation.
 * Use when note names are ambiguous across directories.
 * Obsidian resolves path-qualified links deterministically.
 *
 * @param {string} folder - The folder/directory name
 * @param {string} noteName - The note name
 * @param {string} [displayText] - Optional display text for aliased links
 * @returns {string} Path-qualified wikilink: [[folder/noteName]] or [[folder/noteName|displayText]]
 */
function toQualifiedWikilink(folder, noteName, displayText) {
  const qualified = `${folder}/${noteName}`;
  return displayText ? `[[${qualified}|${displayText}]]` : `[[${qualified}]]`;
}

// ── Exports ──────────────────────────────────────────────────────────────────

// Re-export policy modules (Plan 02 addition)
const contentPolicy = require('./content-policy');
const stylePolicy = require('./style-policy');

module.exports = {
  // Core write/read
  vaultWrite,
  vaultRead,

  // Quarantine
  quarantine,

  // Wikilink utilities
  toWikilink,
  toQualifiedWikilink,

  // Bootstrap
  bootstrapVault,

  // Config management
  initGateway,
  getConfig,
  loadConfig,
  validateConfig,

  // Path security (exported for testing and downstream consumers)
  normalizePath,
  checkPath,

  // Audit logging
  logDecision,

  // Error class
  VaultWriteError,

  // Constants
  VAULT_ROOT,

  // Config events (hot-reload)
  configEvents,

  // Content policy exports (Plan 02)
  ...contentPolicy,

  // Style policy exports (Plan 02)
  ...stylePolicy,
};
