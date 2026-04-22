'use strict';

/**
 * types.test.js
 *
 * Tests for:
 *   - SOURCE enum (frozen, correct values, exact size)
 *   - makeResult (D-15 uniform success shape)
 *   - makeError (D-15 uniform error shape)
 *   - loadConnectorsConfig (file loading, schema validation, fail-fast)
 *   - getConnectorsConfig (memoized lazy wrapper)
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// ── Helpers ────────────────────────────────────────────────────────────────

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Create a temp config directory with the given connectors.json content,
 * set CONFIG_DIR_OVERRIDE, run fn, then restore the override.
 */
function withTempConfig(connectorsJson, fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-connectors-test-'));
  const schemaDir = path.join(tmpDir, 'schema');
  fs.mkdirSync(schemaDir);

  // Write connectors.json
  if (connectorsJson !== null) {
    fs.writeFileSync(
      path.join(tmpDir, 'connectors.json'),
      typeof connectorsJson === 'string' ? connectorsJson : JSON.stringify(connectorsJson),
      'utf8'
    );
  }

  // Copy real connectors.schema.json into temp schema dir
  const realSchemaPath = path.join(__dirname, '..', '..', 'config', 'schema', 'connectors.schema.json');
  if (fs.existsSync(realSchemaPath)) {
    fs.copyFileSync(realSchemaPath, path.join(schemaDir, 'connectors.schema.json'));
  }

  const prev = process.env.CONFIG_DIR_OVERRIDE;
  process.env.CONFIG_DIR_OVERRIDE = tmpDir;

  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env.CONFIG_DIR_OVERRIDE;
    } else {
      process.env.CONFIG_DIR_OVERRIDE = prev;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── SOURCE enum ─────────────────────────────────────────────────────────────

describe('SOURCE enum', () => {
  let SOURCE;

  beforeAll(() => {
    ({ SOURCE } = require('../../src/connectors/types'));
  });

  test('SOURCE.CALENDAR === "calendar"', () => {
    expect(SOURCE.CALENDAR).toBe('calendar');
  });

  test('SOURCE.GMAIL === "gmail"', () => {
    expect(SOURCE.GMAIL).toBe('gmail');
  });

  test('SOURCE.GITHUB === "github"', () => {
    expect(SOURCE.GITHUB).toBe('github');
  });

  test('Object.isFrozen(SOURCE) === true', () => {
    expect(Object.isFrozen(SOURCE)).toBe(true);
  });

  test('Object.keys(SOURCE).length === 3', () => {
    expect(Object.keys(SOURCE)).toHaveLength(3);
  });
});

// ── makeResult ──────────────────────────────────────────────────────────────

describe('makeResult', () => {
  let SOURCE, makeResult;

  beforeAll(() => {
    ({ SOURCE, makeResult } = require('../../src/connectors/types'));
  });

  test('returns D-15 uniform success shape for CALENDAR', () => {
    const data = { events: [] };
    const result = makeResult(SOURCE.CALENDAR, data);
    expect(result.success).toBe(true);
    expect(result.data).toBe(data);
    expect(result.error).toBeNull();
    expect(result.source).toBe('calendar');
    expect(typeof result.fetchedAt).toBe('string');
    expect(ISO8601_RE.test(result.fetchedAt)).toBe(true);
  });

  test('returns D-15 uniform success shape for GMAIL', () => {
    const data = { messages: ['hello'] };
    const result = makeResult(SOURCE.GMAIL, data);
    expect(result.success).toBe(true);
    expect(result.data).toBe(data);
    expect(result.error).toBeNull();
    expect(result.source).toBe('gmail');
  });

  test('returns D-15 uniform success shape for GITHUB', () => {
    const data = { commits: 5 };
    const result = makeResult(SOURCE.GITHUB, data);
    expect(result.success).toBe(true);
    expect(result.source).toBe('github');
  });

  test('result has exactly the required 5 fields', () => {
    const result = makeResult(SOURCE.CALENDAR, {});
    expect(Object.keys(result).sort()).toEqual(['data', 'error', 'fetchedAt', 'source', 'success']);
  });

  test('throws when source is not in SOURCE enum', () => {
    expect(() => makeResult('invalid-source', {})).toThrow();
  });

  test('throws when source is undefined', () => {
    expect(() => makeResult(undefined, {})).toThrow();
  });
});

// ── makeError ───────────────────────────────────────────────────────────────

describe('makeError', () => {
  let SOURCE, makeError;

  beforeAll(() => {
    ({ SOURCE, makeError } = require('../../src/connectors/types'));
  });

  test('returns D-15 uniform error shape for GMAIL', () => {
    const result = makeError(SOURCE.GMAIL, 'MCP timeout');
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBe('MCP timeout');
    expect(result.source).toBe('gmail');
    expect(typeof result.fetchedAt).toBe('string');
    expect(ISO8601_RE.test(result.fetchedAt)).toBe(true);
  });

  test('returns D-15 uniform error shape for CALENDAR', () => {
    const result = makeError(SOURCE.CALENDAR, 'Auth expired');
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBe('Auth expired');
    expect(result.source).toBe('calendar');
  });

  test('returns D-15 uniform error shape for GITHUB', () => {
    const result = makeError(SOURCE.GITHUB, 'Rate limit');
    expect(result.success).toBe(false);
    expect(result.source).toBe('github');
  });

  test('result has exactly the required 5 fields', () => {
    const result = makeError(SOURCE.GMAIL, 'error');
    expect(Object.keys(result).sort()).toEqual(['data', 'error', 'fetchedAt', 'source', 'success']);
  });

  test('throws when source is not in SOURCE enum', () => {
    expect(() => makeError('bad-source', 'message')).toThrow();
  });

  test('throws when source is undefined', () => {
    expect(() => makeError(undefined, 'message')).toThrow();
  });
});

// ── loadConnectorsConfig ─────────────────────────────────────────────────────

describe('loadConnectorsConfig', () => {
  const VALID_CONFIG = {
    calendar: {
      workingHours: { start: 8, end: 18 },
      excludeDeclined: true,
      defaultWindowHours: 24,
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

  test('returns parsed config with calendar, gmail, github sections', () => {
    const { loadConnectorsConfig } = require('../../src/connectors/types');
    const config = withTempConfig(VALID_CONFIG, () => loadConnectorsConfig());
    expect(config.calendar).toBeDefined();
    expect(config.gmail).toBeDefined();
    expect(config.github).toBeDefined();
  });

  test('throws when connectors.json is missing', () => {
    const { loadConnectorsConfig } = require('../../src/connectors/types');
    expect(() => {
      withTempConfig(null, () => loadConnectorsConfig());
    }).toThrow();
  });

  test('throws when required section "calendar" is absent', () => {
    const { loadConnectorsConfig } = require('../../src/connectors/types');
    const badConfig = { gmail: VALID_CONFIG.gmail, github: VALID_CONFIG.github };
    expect(() => {
      withTempConfig(badConfig, () => loadConnectorsConfig());
    }).toThrow();
  });

  test('throws when required section "gmail" is absent', () => {
    const { loadConnectorsConfig } = require('../../src/connectors/types');
    const badConfig = { calendar: VALID_CONFIG.calendar, github: VALID_CONFIG.github };
    expect(() => {
      withTempConfig(badConfig, () => loadConnectorsConfig());
    }).toThrow();
  });

  test('throws when required section "github" is absent', () => {
    const { loadConnectorsConfig } = require('../../src/connectors/types');
    const badConfig = { calendar: VALID_CONFIG.calendar, gmail: VALID_CONFIG.gmail };
    expect(() => {
      withTempConfig(badConfig, () => loadConnectorsConfig());
    }).toThrow();
  });

  test('throws when schema validation fails (wrong type)', () => {
    const { loadConnectorsConfig } = require('../../src/connectors/types');
    const badConfig = {
      ...VALID_CONFIG,
      calendar: { ...VALID_CONFIG.calendar, defaultWindowHours: 'not-a-number' },
    };
    expect(() => {
      withTempConfig(badConfig, () => loadConnectorsConfig());
    }).toThrow(/validation failed/i);
  });

  test('throws when schema validation fails (missing required nested field)', () => {
    const { loadConnectorsConfig } = require('../../src/connectors/types');
    const badConfig = {
      ...VALID_CONFIG,
      github: { owner: 'UsernameTron', defaultWindowHours: 24 }, // missing repos
    };
    expect(() => {
      withTempConfig(badConfig, () => loadConnectorsConfig());
    }).toThrow(/validation failed/i);
  });

  test('throws when schema validation fails (out-of-range value)', () => {
    const { loadConnectorsConfig } = require('../../src/connectors/types');
    const badConfig = {
      ...VALID_CONFIG,
      gmail: { ...VALID_CONFIG.gmail, maxResults: 0 }, // minimum 1
    };
    expect(() => {
      withTempConfig(badConfig, () => loadConnectorsConfig());
    }).toThrow(/validation failed/i);
  });

  test('throws with descriptive message on schema violation', () => {
    const { loadConnectorsConfig } = require('../../src/connectors/types');
    const badConfig = {
      ...VALID_CONFIG,
      github: { ...VALID_CONFIG.github, repos: [] }, // minItems 1
    };
    let thrownError;
    try {
      withTempConfig(badConfig, () => loadConnectorsConfig());
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeDefined();
    expect(thrownError.message).toMatch(/connectors\.json validation failed/i);
  });
});

// ── getConnectorsConfig (memoized) ───────────────────────────────────────────

describe('getConnectorsConfig', () => {
  const VALID_CONFIG = {
    calendar: {
      workingHours: { start: 8, end: 18 },
      excludeDeclined: true,
      defaultWindowHours: 24,
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

  test('returns same config object on repeated calls (memoized)', () => {
    // Use jest.resetModules to get a fresh module with no cached config
    jest.resetModules();
    const { getConnectorsConfig } = require('../../src/connectors/types');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-memo-test-'));
    const schemaDir = path.join(tmpDir, 'schema');
    fs.mkdirSync(schemaDir);
    fs.writeFileSync(path.join(tmpDir, 'connectors.json'), JSON.stringify(VALID_CONFIG), 'utf8');
    const realSchemaPath = path.join(__dirname, '..', '..', 'config', 'schema', 'connectors.schema.json');
    if (fs.existsSync(realSchemaPath)) {
      fs.copyFileSync(realSchemaPath, path.join(schemaDir, 'connectors.schema.json'));
    }

    const prev = process.env.CONFIG_DIR_OVERRIDE;
    process.env.CONFIG_DIR_OVERRIDE = tmpDir;

    try {
      const config1 = getConnectorsConfig();
      const config2 = getConnectorsConfig();
      expect(config1).toBe(config2); // same reference
    } finally {
      if (prev === undefined) {
        delete process.env.CONFIG_DIR_OVERRIDE;
      } else {
        process.env.CONFIG_DIR_OVERRIDE = prev;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
