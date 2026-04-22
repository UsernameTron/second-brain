'use strict';

/**
 * gmail.js
 *
 * Gmail connector for the second-brain project.
 * Wraps the `gmail-mcp-pete` MCP server's three tools with connector-side
 * VIP filtering and the uniform D-15 return shape.
 *
 * MCP tools exposed by the server (D-08):
 *   - list_recent_messages
 *   - get_message_body
 *   - create_draft
 *
 * VIP filtering (D-09 + D-10):
 *   - Layer 1 (server-side, D-09): allowedSenders passed to list_recent_messages
 *     so the server enforces trust-boundary — only VIP messages cross process boundary.
 *   - Layer 2 (connector-side, D-10): connector additionally filters response
 *     against config.vipSenders (case-insensitive). Defense-in-depth — if server-side
 *     filter is misconfigured, connector still enforces project VIP policy.
 *
 * Security:
 *   - No send-verb exports or MCP calls (D-05, D-08)
 *   - OAuth scopes: gmail.readonly + gmail.compose only (enforced at OAuth level)
 *
 * Error handling (D-18):
 *   - No-throw contract: all errors caught, returned as { success: false }
 *   - Never throws — callers need no try/catch
 *
 * @module src/connectors/gmail
 */

const { SOURCE, makeResult, makeError, loadConnectorsConfig } = require('./types');

// ── Lazy memoized config loader ───────────────────────────────────────────────

let _config = null;

/**
 * Return the gmail section of connectors.json, loading once on first call.
 * Lazy loading ensures CONFIG_DIR_OVERRIDE (set in tests) takes effect.
 *
 * @returns {{ vipSenders: string[], defaultWindowHours: number, maxResults: number }}
 */
function _getConfig() {
  if (!_config) {
    _config = loadConnectorsConfig().gmail;
  }
  return _config;
}

// ── VIP matching helper ───────────────────────────────────────────────────────

/**
 * Check whether a sender email matches any entry in the VIP list (case-insensitive).
 *
 * Handles "Display Name <email@domain.com>" format by extracting the
 * angle-bracket portion when present, falling back to the raw string.
 *
 * @param {string} from - The "from" field from an email message
 * @param {string[]} vipSenders - List of VIP email addresses (lowercase expected)
 * @returns {boolean}
 */
function _isVipSender(from, vipSenders) {
  if (!from) return false;
  // Extract email from "Display Name <email>" format if present
  const match = from.match(/<([^>]+)>/);
  const email = (match ? match[1] : from).toLowerCase().trim();
  const vipLower = vipSenders.map(s => s.toLowerCase().trim());
  return vipLower.includes(email);
}

// ── getRecentEmails ───────────────────────────────────────────────────────────

/**
 * Fetch recent emails, applying two-layer VIP filtering (D-09 + D-10).
 *
 * Layer 1 (D-09): passes config.vipSenders as allowedSenders to the MCP server
 * so only VIP messages cross the process boundary.
 *
 * Layer 2 (D-10): when vipOnly=true, additionally filters the response
 * against config.vipSenders. This is the project-specific enforcement point —
 * the server-side list is a superset; the connector enforces the project subset.
 *
 * @param {object} mcpClient - MCP client with callTool(toolName, params) method
 * @param {object} [options={}] - Options
 * @param {number} [options.hours] - Time window in hours (defaults to config.defaultWindowHours)
 * @param {boolean} [options.vipOnly=true] - If true, apply connector-side VIP filter
 * @param {number} [options.maxResults] - Max results (defaults to config.maxResults)
 * @returns {Promise<{success: boolean, data: *, error: *, source: string, fetchedAt: string}>}
 */
async function getRecentEmails(mcpClient, options = {}) {
  if (!mcpClient) {
    return makeError(SOURCE.GMAIL, 'mcpClient is required');
  }

  const config = _getConfig();
  const windowHours = options.hours !== undefined ? options.hours : config.defaultWindowHours;
  const vipOnly = options.vipOnly !== undefined ? options.vipOnly : true;
  const maxResults = options.maxResults !== undefined ? options.maxResults : config.maxResults;

  try {
    // D-09: pass allowedSenders to server for trust-boundary enforcement
    const messages = await mcpClient.callTool('list_recent_messages', {
      hours: windowHours,
      maxResults,
      allowedSenders: config.vipSenders,
    });

    // D-10: connector-side VIP filter (defense-in-depth)
    const filteredMessages = vipOnly
      ? (messages || []).filter(msg => _isVipSender(msg.from, config.vipSenders))
      : (messages || []);

    return makeResult(SOURCE.GMAIL, { messages: filteredMessages });
  } catch (error) {
    return makeError(SOURCE.GMAIL, error.message || 'Gmail MCP call failed');
  }
}

// ── getEmailBody ──────────────────────────────────────────────────────────────

/**
 * Fetch the full body of a specific email message.
 *
 * @param {object} mcpClient - MCP client with callTool(toolName, params) method
 * @param {string} messageId - The message ID to fetch
 * @returns {Promise<{success: boolean, data: *, error: *, source: string, fetchedAt: string}>}
 */
async function getEmailBody(mcpClient, messageId) {
  if (!mcpClient) {
    return makeError(SOURCE.GMAIL, 'mcpClient is required');
  }
  if (!messageId) {
    return makeError(SOURCE.GMAIL, 'messageId is required');
  }

  try {
    const result = await mcpClient.callTool('get_message_body', { messageId });
    return makeResult(SOURCE.GMAIL, { message: result });
  } catch (error) {
    return makeError(SOURCE.GMAIL, error.message || 'Gmail message fetch failed');
  }
}

// ── createDraft ───────────────────────────────────────────────────────────────

/**
 * Create a Gmail draft (compose-only — no send capability).
 *
 * Per D-05: OAuth scope is gmail.compose which excludes gmail.send.
 * This connector function and the MCP tool it calls are draft-only by design.
 * There is no send function in this module and no send_message MCP call.
 *
 * @param {object} mcpClient - MCP client with callTool(toolName, params) method
 * @param {object} params - Draft parameters
 * @param {string} params.to - Recipient email address
 * @param {string} params.subject - Email subject
 * @param {string} [params.body] - Email body
 * @returns {Promise<{success: boolean, data: *, error: *, source: string, fetchedAt: string}>}
 */
async function createDraft(mcpClient, { to, subject, body } = {}) {
  if (!mcpClient) {
    return makeError(SOURCE.GMAIL, 'mcpClient is required');
  }
  if (!to || !subject) {
    return makeError(SOURCE.GMAIL, 'to and subject are required');
  }

  try {
    const result = await mcpClient.callTool('create_draft', { to, subject, body });
    return makeResult(SOURCE.GMAIL, { draft: result });
  } catch (error) {
    return makeError(SOURCE.GMAIL, error.message || 'Gmail draft creation failed');
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

// Exported surface: list, get, draft — no send functions (D-05, D-08)
module.exports = { getRecentEmails, getEmailBody, createDraft };
