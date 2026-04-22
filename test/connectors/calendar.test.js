'use strict';

/**
 * test/connectors/calendar.test.js
 *
 * Unit tests for src/connectors/calendar.js
 * Uses mocked MCP transport — no live Cowork MCP calls.
 *
 * Covers:
 *   - getCalendarEvents: filtering (declined, working hours, all-day)
 *   - getCalendarEvents: mcpClient guard, error handling
 *   - getCalendarEvents: default window hours from config
 *   - getCalendarEvents: case-insensitive attendee matching
 *   - getEvent: success and error paths
 *   - Contract: D-15 uniform result shape on all paths
 *   - Contract: D-02 no write-verb exports
 *
 * @module test/connectors/calendar.test
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// ── Config override setup ────────────────────────────────────────────────────
// Point CONFIG_DIR_OVERRIDE to a temp dir containing a minimal connectors.json
// and schema. Must be set BEFORE requiring calendar.js or types.js.

let testConfigDir;

beforeAll(() => {
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-test-config-'));

  // Minimal connectors.json for tests
  const connectorsCfg = {
    calendar: {
      workingHours: { start: 8, end: 18 },
      excludeDeclined: true,
      defaultWindowHours: 24,
      userEmail: 'cpeteconnor@gmail.com',
      timezone: 'America/New_York',
    },
    gmail: {
      vipSenders: ['cpeteconnor@gmail.com'],
      defaultWindowHours: 24,
      maxResults: 20,
    },
    github: {
      owner: 'UsernameTron',
      repos: ['second-brain'],
      defaultWindowHours: 24,
    },
  };

  // Write connectors.json
  fs.writeFileSync(
    path.join(testConfigDir, 'connectors.json'),
    JSON.stringify(connectorsCfg, null, 2),
  );

  // Write schema directory
  fs.mkdirSync(path.join(testConfigDir, 'schema'), { recursive: true });

  // Minimal schema that accepts our test config
  const schema = {
    type: 'object',
    properties: {
      calendar: {
        type: 'object',
        required: ['workingHours', 'excludeDeclined', 'defaultWindowHours'],
        properties: {
          workingHours: {
            type: 'object',
            required: ['start', 'end'],
            properties: {
              start: { type: 'number' },
              end: { type: 'number' },
            },
          },
          excludeDeclined: { type: 'boolean' },
          defaultWindowHours: { type: 'number' },
          userEmail: { type: 'string' },
          timezone: { type: 'string' },
        },
      },
      gmail: {
        type: 'object',
        required: ['vipSenders', 'defaultWindowHours', 'maxResults'],
        properties: {
          vipSenders: { type: 'array', items: { type: 'string' } },
          defaultWindowHours: { type: 'number' },
          maxResults: { type: 'number' },
        },
      },
      github: {
        type: 'object',
        required: ['owner', 'repos', 'defaultWindowHours'],
        properties: {
          owner: { type: 'string' },
          repos: { type: 'array', items: { type: 'string' } },
          defaultWindowHours: { type: 'number' },
        },
      },
    },
    required: ['calendar', 'gmail', 'github'],
  };

  fs.writeFileSync(
    path.join(testConfigDir, 'schema', 'connectors.schema.json'),
    JSON.stringify(schema, null, 2),
  );

  process.env.CONFIG_DIR_OVERRIDE = testConfigDir;
});

afterAll(() => {
  delete process.env.CONFIG_DIR_OVERRIDE;
  // Clean up temp dir
  fs.rmSync(testConfigDir, { recursive: true, force: true });
});

// ── Module imports (after env setup) ────────────────────────────────────────
// Use jest.isolateModules or require inside beforeAll is needed if module
// caches config. We require lazily per test suite to get fresh module.

const { assertSuccessShape, assertErrorShape, assertSourceEnum } = require('./helpers');
const { SOURCE } = require('../../src/connectors/types');

// ── Time helpers ─────────────────────────────────────────────────────────────
// Produce ISO8601 strings that represent events within or outside 08:00-18:00
// Eastern time for test assertions.

/** Returns an ISO8601 dateTime string for a time that is within working hours (10:00 ET) */
function withinHoursISO() {
  // Use a fixed date with time 14:00 UTC = 10:00 ET (UTC-4 in summer / UTC-5 in winter)
  // We build a date-string and let JS parse it. Use UTC noon to avoid DST ambiguity.
  const d = new Date();
  d.setUTCHours(15, 0, 0, 0); // 15:00 UTC = 11:00 ET (safe inside 08:00-18:00 ET)
  return d.toISOString();
}

/** Returns an ISO8601 dateTime string for a time that is outside working hours (22:00 ET = 02:00 UTC next day) */
function outsideHoursISO() {
  const d = new Date();
  d.setUTCHours(4, 0, 0, 0); // 04:00 UTC = 00:00 ET (midnight, outside 08:00-18:00)
  return d.toISOString();
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A valid event that should pass all filters */
function makeValidEvent(overrides = {}) {
  return {
    id: 'event-valid',
    summary: 'Team Standup',
    start: { dateTime: withinHoursISO() },
    end: { dateTime: withinHoursISO() },
    attendees: [
      { email: 'colleague@example.com', responseStatus: 'accepted' },
      { email: 'cpeteconnor@gmail.com', responseStatus: 'accepted' },
    ],
    ...overrides,
  };
}

/** A declined event — should be filtered out */
function makeDeclinedEvent(overrides = {}) {
  return {
    id: 'event-declined',
    summary: 'Event I Declined',
    start: { dateTime: withinHoursISO() },
    end: { dateTime: withinHoursISO() },
    attendees: [
      { email: 'cpeteconnor@gmail.com', responseStatus: 'declined' },
    ],
    ...overrides,
  };
}

/** An outside-hours event — should be filtered out */
function makeOutsideHoursEvent(overrides = {}) {
  return {
    id: 'event-outside',
    summary: 'Late Night Call',
    start: { dateTime: outsideHoursISO() },
    end: { dateTime: outsideHoursISO() },
    attendees: [
      { email: 'cpeteconnor@gmail.com', responseStatus: 'accepted' },
    ],
    ...overrides,
  };
}

/** An all-day event — should be included unless declined */
function makeAllDayEvent(overrides = {}) {
  return {
    id: 'event-allday',
    summary: 'All Day Off',
    start: { date: '2026-04-22' },
    end: { date: '2026-04-23' },
    attendees: [],
    ...overrides,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('getCalendarEvents', () => {
  let getCalendarEvents;
  let getEvent;
  let mcpClient;

  beforeEach(() => {
    jest.resetModules();
    // Re-require with fresh module registry so cached config is reset
    ({ getCalendarEvents, getEvent } = require('../../src/connectors/calendar'));
    mcpClient = { callTool: jest.fn() };
  });

  // ── Guard tests ─────────────────────────────────────────────────────────────

  it('returns error when mcpClient is null', async () => {
    const result = await getCalendarEvents(null);
    assertErrorShape(result);
    expect(result.error).toMatch(/mcpClient is required/);
    expect(result.source).toBe(SOURCE.CALENDAR);
  });

  it('returns error when mcpClient is undefined', async () => {
    const result = await getCalendarEvents(undefined);
    assertErrorShape(result);
    expect(result.error).toMatch(/mcpClient is required/);
  });

  it('returns error when mcpClient is called with no arguments', async () => {
    const result = await getCalendarEvents();
    assertErrorShape(result);
    expect(result.error).toMatch(/mcpClient is required/);
  });

  // ── MCP error handling ──────────────────────────────────────────────────────

  it('returns error result when MCP tool throws', async () => {
    mcpClient.callTool.mockRejectedValue(new Error('MCP transport failure'));
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertErrorShape(result);
    expect(result.error).toMatch(/MCP transport failure/);
    expect(result.source).toBe(SOURCE.CALENDAR);
  });

  it('returns error result when MCP tool rejects with non-Error', async () => {
    mcpClient.callTool.mockRejectedValue('string error');
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertErrorShape(result);
    expect(result.source).toBe(SOURCE.CALENDAR);
  });

  // ── Empty results ───────────────────────────────────────────────────────────

  it('returns success with empty events array when MCP returns no events', async () => {
    mcpClient.callTool.mockResolvedValue({ events: [] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toEqual([]);
    expect(result.source).toBe(SOURCE.CALENDAR);
  });

  // ── Filtering: declined events ──────────────────────────────────────────────

  it('filters out declined events', async () => {
    mcpClient.callTool.mockResolvedValue({
      events: [makeDeclinedEvent(), makeValidEvent()],
    });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(1);
    expect(result.data.events[0].id).toBe('event-valid');
  });

  it('includes events where Pete accepted', async () => {
    mcpClient.callTool.mockResolvedValue({ events: [makeValidEvent()] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(1);
  });

  it('includes events with no attendees (organizer-only events)', async () => {
    mcpClient.callTool.mockResolvedValue({
      events: [makeValidEvent({ attendees: [] })],
    });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(1);
  });

  // ── Filtering: case-insensitive attendee email ──────────────────────────────

  it('matches attendee email case-insensitively for declined filter', async () => {
    const mixedCaseDeclined = makeValidEvent({
      id: 'event-case',
      attendees: [
        { email: 'CPeteConnor@Gmail.Com', responseStatus: 'declined' },
      ],
    });
    mcpClient.callTool.mockResolvedValue({ events: [mixedCaseDeclined] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(0); // declined despite case mismatch
  });

  it('matches attendee email case-insensitively for accepted filter', async () => {
    const mixedCaseAccepted = makeValidEvent({
      id: 'event-case-accepted',
      attendees: [
        { email: 'CPETECONNOR@GMAIL.COM', responseStatus: 'accepted' },
      ],
    });
    mcpClient.callTool.mockResolvedValue({ events: [mixedCaseAccepted] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(1);
  });

  // ── Filtering: working hours ────────────────────────────────────────────────

  it('filters out events outside working hours', async () => {
    mcpClient.callTool.mockResolvedValue({ events: [makeOutsideHoursEvent()] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(0);
  });

  it('includes events within working hours', async () => {
    mcpClient.callTool.mockResolvedValue({ events: [makeValidEvent()] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(1);
  });

  it('filters by all three criteria simultaneously (1 valid of 3)', async () => {
    mcpClient.callTool.mockResolvedValue({
      events: [
        makeDeclinedEvent(),        // filtered: declined
        makeOutsideHoursEvent(),    // filtered: outside hours
        makeValidEvent(),           // kept: passes all filters
      ],
    });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(1);
    expect(result.data.events[0].id).toBe('event-valid');
  });

  // ── All-day events ──────────────────────────────────────────────────────────

  it('includes all-day events (no start.dateTime) — bypass working hours filter', async () => {
    mcpClient.callTool.mockResolvedValue({ events: [makeAllDayEvent()] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(1);
    expect(result.data.events[0].id).toBe('event-allday');
  });

  it('filters out all-day events if Pete declined', async () => {
    const declinedAllDay = makeAllDayEvent({
      attendees: [{ email: 'cpeteconnor@gmail.com', responseStatus: 'declined' }],
    });
    mcpClient.callTool.mockResolvedValue({ events: [declinedAllDay] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
    expect(result.data.events).toHaveLength(0);
  });

  // ── Default window hours ────────────────────────────────────────────────────

  it('uses defaultWindowHours from config when no options passed', async () => {
    mcpClient.callTool.mockResolvedValue({ events: [] });
    const result = await getCalendarEvents(mcpClient);
    assertSuccessShape(result);
    // Verify callTool was called with timeMin and timeMax
    expect(mcpClient.callTool).toHaveBeenCalledWith(
      'list_calendar_events',
      expect.objectContaining({ timeMin: expect.any(String), timeMax: expect.any(String) }),
    );
  });

  it('uses options.hours when provided', async () => {
    mcpClient.callTool.mockResolvedValue({ events: [] });
    await getCalendarEvents(mcpClient, { hours: 48 });
    const callArgs = mcpClient.callTool.mock.calls[0][1];
    const timeMin = new Date(callArgs.timeMin).getTime();
    const timeMax = new Date(callArgs.timeMax).getTime();
    const diffHours = (timeMax - timeMin) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(48, 0);
  });

  // ── Source field ─────────────────────────────────────────────────────────────

  it('always sets source to SOURCE.CALENDAR on success', async () => {
    mcpClient.callTool.mockResolvedValue({ events: [] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSourceEnum(result);
    expect(result.source).toBe(SOURCE.CALENDAR);
  });

  it('always sets source to SOURCE.CALENDAR on error', async () => {
    mcpClient.callTool.mockRejectedValue(new Error('fail'));
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSourceEnum(result);
    expect(result.source).toBe(SOURCE.CALENDAR);
  });

  // ── Result shape contract ───────────────────────────────────────────────────

  it('success result passes assertSuccessShape contract', async () => {
    mcpClient.callTool.mockResolvedValue({ events: [makeValidEvent()] });
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertSuccessShape(result);
  });

  it('error result passes assertErrorShape contract', async () => {
    mcpClient.callTool.mockRejectedValue(new Error('network error'));
    const result = await getCalendarEvents(mcpClient, { hours: 24 });
    assertErrorShape(result);
  });
});

// ── getEvent tests ────────────────────────────────────────────────────────────

describe('getEvent', () => {
  let getCalendarEvents;
  let getEvent;
  let mcpClient;

  beforeEach(() => {
    jest.resetModules();
    ({ getCalendarEvents, getEvent } = require('../../src/connectors/calendar'));
    mcpClient = { callTool: jest.fn() };
  });

  it('returns error when mcpClient is null', async () => {
    const result = await getEvent(null, 'event-123');
    assertErrorShape(result);
    expect(result.error).toMatch(/mcpClient is required/);
    expect(result.source).toBe(SOURCE.CALENDAR);
  });

  it('returns error when eventId is missing', async () => {
    const result = await getEvent(mcpClient, null);
    assertErrorShape(result);
    expect(result.error).toMatch(/eventId is required/);
    expect(result.source).toBe(SOURCE.CALENDAR);
  });

  it('returns error when eventId is empty string', async () => {
    const result = await getEvent(mcpClient, '');
    assertErrorShape(result);
    expect(result.error).toMatch(/eventId is required/);
  });

  it('returns single event in uniform shape on success', async () => {
    const mockEvent = makeValidEvent({ id: 'event-123' });
    mcpClient.callTool.mockResolvedValue({ event: mockEvent });
    const result = await getEvent(mcpClient, 'event-123');
    assertSuccessShape(result);
    expect(result.data.event.id).toBe('event-123');
    expect(result.source).toBe(SOURCE.CALENDAR);
  });

  it('returns error result when MCP tool throws', async () => {
    mcpClient.callTool.mockRejectedValue(new Error('event not found'));
    const result = await getEvent(mcpClient, 'event-123');
    assertErrorShape(result);
    expect(result.error).toMatch(/event not found/);
  });

  it('calls get_calendar_event MCP tool with eventId', async () => {
    mcpClient.callTool.mockResolvedValue({ event: makeValidEvent({ id: 'event-456' }) });
    await getEvent(mcpClient, 'event-456');
    expect(mcpClient.callTool).toHaveBeenCalledWith(
      'get_calendar_event',
      expect.objectContaining({ eventId: 'event-456' }),
    );
  });

  it('success result passes assertSuccessShape contract', async () => {
    mcpClient.callTool.mockResolvedValue({ event: makeValidEvent() });
    const result = await getEvent(mcpClient, 'event-123');
    assertSuccessShape(result);
  });

  it('error result passes assertErrorShape contract', async () => {
    mcpClient.callTool.mockRejectedValue(new Error('network error'));
    const result = await getEvent(mcpClient, 'event-123');
    assertErrorShape(result);
  });
});

// ── D-02 Contract: no write-verb exports ─────────────────────────────────────

describe('D-02 contract: no write-verb exports', () => {
  it('exports no write-verb functions (create, update, delete, patch)', () => {
    jest.resetModules();
    const calendar = require('../../src/connectors/calendar');
    const exportedNames = Object.keys(calendar);
    const writeVerbs = exportedNames.filter((name) =>
      /^(create|update|delete|patch)/i.test(name),
    );
    expect(writeVerbs).toEqual([]);
  });

  it('exports exactly getCalendarEvents and getEvent', () => {
    jest.resetModules();
    const calendar = require('../../src/connectors/calendar');
    expect(Object.keys(calendar).sort()).toEqual(['getCalendarEvents', 'getEvent'].sort());
  });
});
