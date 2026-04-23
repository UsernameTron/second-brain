'use strict';

/**
 * calendar.js
 *
 * Google Calendar connector — wraps Cowork native MCP tools
 * (`mcp__claude_ai_Google_Calendar__*`) via dependency-injected mcpClient.
 *
 * Design principles (D-01 through D-03, D-15, D-18):
 *
 *   D-01  Uses Cowork native MCP transport via injected mcpClient.callTool().
 *         Consumers provide the transport; tests inject a Jest mock.
 *
 *   D-02  Read-only by API omission. Only getCalendarEvents and getEvent are
 *         exported. No create/update/delete/patch functions exist in this module.
 *         A contract test in calendar.test.js asserts the export surface contains
 *         no write verbs.
 *
 *   D-03  Filtering applied inside the connector before returning to caller:
 *         - Declined-event filter: removes events where Pete's attendee response
 *           is 'declined'. Email match is case-insensitive.
 *         - Working-hours filter: removes timed events (start.dateTime) whose
 *           start hour (in configured or system timezone) falls outside
 *           [workingHours.start, workingHours.end). All-day events (start.date
 *           only) bypass the working-hours filter but still obey the declined filter.
 *
 *   D-15  Returns { success, data, error, source, fetchedAt } via makeResult /
 *         makeError from types.js. Source is always SOURCE.CALENDAR.
 *
 *   D-18  No-throw contract: all errors caught and returned as { success: false }.
 *         Callers never need try/catch.
 *
 * @module src/connectors/calendar
 */

const { SOURCE, makeResult, makeError, loadConnectorsConfig } = require('./types');

// ── Config ───────────────────────────────────────────────────────────────────
// Loaded at call time (not module load time) so CONFIG_DIR_OVERRIDE set in
// tests takes effect. loadConnectorsConfig reads process.env.CONFIG_DIR_OVERRIDE
// dynamically via _getConfigDir() in types.js.

function _loadConfig() {
  return loadConnectorsConfig().calendar;
}

// ── Timezone helpers ─────────────────────────────────────────────────────────

/**
 * Return the hour-of-day for a dateTime string in the given IANA timezone.
 * Uses Intl.DateTimeFormat to perform timezone conversion — avoids manual
 * UTC offset arithmetic that breaks across DST transitions.
 *
 * @param {string} dateTimeISO - ISO 8601 dateTime string
 * @param {string} timezone    - IANA timezone (e.g., 'America/New_York')
 * @returns {number} Hour in [0, 23]
 */
function _getHourInTimezone(dateTimeISO, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
  });
  const parts = formatter.formatToParts(new Date(dateTimeISO));
  const hourPart = parts.find((p) => p.type === 'hour');
  // 'hour12: false' with '24' returns hour as '0'-'23' but Intl may return '24'
  // for midnight in some environments; normalise to 0.
  const h = parseInt(hourPart.value, 10);
  return h === 24 ? 0 : h;
}

// ── Filtering helpers ────────────────────────────────────────────────────────

/**
 * Return true if Pete (identified by userEmail) declined this event.
 * Match is case-insensitive per D-03.
 *
 * @param {object} event     - Calendar event object
 * @param {string} userEmail - Pete's email address (lower-cased comparison)
 * @returns {boolean}
 */
function _isDeclined(event, userEmail) {
  if (!Array.isArray(event.attendees) || event.attendees.length === 0) {
    return false;
  }
  const peteEmail = userEmail.toLowerCase();
  const peteAttendee = event.attendees.find(
    (a) => (a.email || '').toLowerCase() === peteEmail,
  );
  return peteAttendee ? peteAttendee.responseStatus === 'declined' : false;
}

/**
 * Return true if a timed event starts within the configured working hours.
 * Always returns true for all-day events (which have start.date, not start.dateTime).
 *
 * @param {object} event    - Calendar event object
 * @param {object} config   - Calendar config section (workingHours, timezone)
 * @returns {boolean} Whether the event should be included after hours filter
 */
function _isWithinWorkingHours(event, config) {
  // All-day events: no start.dateTime — bypass working hours filter
  if (!event.start || !event.start.dateTime) {
    return true;
  }

  const timezone =
    config.timezone ||
    new Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  const startHour = _getHourInTimezone(event.start.dateTime, timezone);
  const { start: wStart, end: wEnd } = config.workingHours;

  // Include if start hour is in [wStart, wEnd)
  return startHour >= wStart && startHour < wEnd;
}

/**
 * Apply all filters to a raw events array.
 *
 * @param {Array}  events    - Raw events from MCP tool
 * @param {object} config    - Calendar config section
 * @returns {Array} Filtered events
 */
function _filterEvents(events, config) {
  if (!Array.isArray(events)) {
    return [];
  }

  const userEmail = config.userEmail || 'cpeteconnor@gmail.com';

  return events.filter((event) => {
    // 1. Declined filter
    if (config.excludeDeclined && _isDeclined(event, userEmail)) {
      return false;
    }
    // 2. Working-hours filter (all-day events bypass this)
    if (!_isWithinWorkingHours(event, config)) {
      return false;
    }
    return true;
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch upcoming calendar events within a time window, applying declined-event
 * and working-hours filters.
 *
 * Per D-18: never throws — all errors returned as { success: false }.
 *
 * Supports two execution modes:
 *   - Local mode: mcpClient provided — uses mcpClient.callTool() (Cowork native transport)
 *   - Remote mode: mcpClient is null and options.remote === true — uses options._remoteCallTool
 *     which represents the MCP tool dispatcher available in the RemoteTrigger context
 *     (the Google Calendar MCP connection attached via config/scheduling.json)
 *
 * @param {object|null} mcpClient        - Object with callTool(toolName, params) async method, or null for remote mode
 * @param {object}      [options={}]     - Options
 * @param {number}      [options.hours]  - Look-ahead window in hours (defaults to config.defaultWindowHours)
 * @param {boolean}     [options.remote] - When true and mcpClient is null, use remote MCP connector path
 * @param {Function}    [options._remoteCallTool] - Injected remote callTool for remote mode (for testing)
 * @returns {Promise<{success: boolean, data: {events: Array}|null, error: string|null, source: string, fetchedAt: string}>}
 */
async function getCalendarEvents(mcpClient, options = {}) {
  const isRemote = !mcpClient && options && options.remote === true;

  // If no mcpClient and not in remote mode, return error
  if (!mcpClient && !isRemote) {
    return makeError(SOURCE.CALENDAR, 'mcpClient is required');
  }

  // Remote mode requires a callTool implementation
  if (isRemote && (!options._remoteCallTool || typeof options._remoteCallTool !== 'function')) {
    return makeError(SOURCE.CALENDAR, 'Remote MCP connector not available');
  }

  try {
    const config = _loadConfig();
    const windowHours = (options && options.hours) || config.defaultWindowHours;

    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + windowHours * 60 * 60 * 1000).toISOString();

    // Dispatch via the appropriate transport
    const callTool = isRemote
      ? options._remoteCallTool
      : mcpClient.callTool.bind(mcpClient);

    const response = await callTool('list_calendar_events', {
      timeMin,
      timeMax,
    });

    const rawEvents = (response && response.events) || [];
    const filteredEvents = _filterEvents(rawEvents, config);

    return makeResult(SOURCE.CALENDAR, { events: filteredEvents });
  } catch (err) {
    const message =
      err && typeof err.message === 'string' && err.message
        ? err.message
        : 'Calendar MCP call failed';
    return makeError(SOURCE.CALENDAR, message);
  }
}

/**
 * Fetch a single calendar event by ID.
 *
 * Per D-18: never throws — all errors returned as { success: false }.
 *
 * @param {object} mcpClient  - Object with callTool(toolName, params) async method
 * @param {string} eventId    - Google Calendar event ID
 * @returns {Promise<{success: boolean, data: {event: object}|null, error: string|null, source: string, fetchedAt: string}>}
 */
async function getEvent(mcpClient, eventId) {
  if (!mcpClient) {
    return makeError(SOURCE.CALENDAR, 'mcpClient is required');
  }

  if (!eventId) {
    return makeError(SOURCE.CALENDAR, 'eventId is required');
  }

  try {
    const result = await mcpClient.callTool('get_calendar_event', { eventId });
    const event = (result && result.event) || result;
    return makeResult(SOURCE.CALENDAR, { event });
  } catch (err) {
    const message =
      err && typeof err.message === 'string' && err.message
        ? err.message
        : 'Calendar event fetch failed';
    return makeError(SOURCE.CALENDAR, message);
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────
// Exactly two read-only functions. No create/update/delete/patch per D-02.

module.exports = { getCalendarEvents, getEvent };
