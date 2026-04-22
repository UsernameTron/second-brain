'use strict';

/**
 * test/connectors/gmail.test.js
 *
 * Unit tests for the Gmail connector (src/connectors/gmail.js).
 * Covers:
 *   - getRecentEmails: VIP filtering (server-side pass-through + connector-side D-10)
 *   - getEmailBody: messageId guard + MCP call
 *   - createDraft: required field guards + MCP call
 *   - No-throw contract (all errors returned as {success: false})
 *   - No send-verb exports (D-05, D-08)
 *   - D-15 uniform return shape (via shared helpers)
 *
 * @module test/connectors/gmail
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

// ── Test connectors.json setup ───────────────────────────────────────────────

let tmpConfigDir;

beforeAll(() => {
  tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-test-config-'));

  const schemaDir = path.join(tmpConfigDir, 'schema');
  fs.mkdirSync(schemaDir);

  // Minimal connectors.json with test VIP senders
  const config = {
    calendar: {
      workingHours: { start: 8, end: 18 },
      excludeDeclined: true,
      defaultWindowHours: 24,
    },
    gmail: {
      vipSenders: ['vip@example.com', 'boss@company.com'],
      defaultWindowHours: 24,
      maxResults: 20,
    },
    github: {
      owner: 'TestOwner',
      repos: ['test-repo'],
      defaultWindowHours: 24,
    },
  };
  fs.writeFileSync(
    path.join(tmpConfigDir, 'connectors.json'),
    JSON.stringify(config)
  );

  // Minimal schema (permissive — validation tested in types.test.js)
  const schema = {
    type: 'object',
    required: ['calendar', 'gmail', 'github'],
    properties: {
      calendar: { type: 'object' },
      gmail: {
        type: 'object',
        required: ['vipSenders', 'defaultWindowHours', 'maxResults'],
        properties: {
          vipSenders: { type: 'array', items: { type: 'string' } },
          defaultWindowHours: { type: 'number' },
          maxResults: { type: 'number' },
        },
      },
      github: { type: 'object' },
    },
  };
  fs.writeFileSync(
    path.join(schemaDir, 'connectors.schema.json'),
    JSON.stringify(schema)
  );

  process.env.CONFIG_DIR_OVERRIDE = tmpConfigDir;
});

afterAll(() => {
  delete process.env.CONFIG_DIR_OVERRIDE;
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
});

// ── Module under test (loaded after env var set) ─────────────────────────────

// Use jest.isolateModules to ensure the module picks up CONFIG_DIR_OVERRIDE
let gmail;
let helpers;

beforeAll(() => {
  jest.isolateModules(() => {
    gmail = require('../../src/connectors/gmail');
    helpers = require('../connectors/helpers');
  });
});

// ── Sample message data ───────────────────────────────────────────────────────

const VIP_MSG_1 = {
  id: 'msg-vip-001',
  from: 'VIP@example.com', // uppercase — tests case-insensitive matching
  subject: 'Important briefing',
  snippet: 'Please review...',
  date: '2026-04-22T09:00:00Z',
};

const VIP_MSG_2 = {
  id: 'msg-vip-002',
  from: 'boss@company.com',
  subject: 'Team update',
  snippet: 'Here is the update...',
  date: '2026-04-22T10:00:00Z',
};

const NON_VIP_MSG_1 = {
  id: 'msg-non-001',
  from: 'newsletter@random.com',
  subject: 'Special offer!',
  snippet: 'Click here...',
  date: '2026-04-22T08:00:00Z',
};

const NON_VIP_MSG_2 = {
  id: 'msg-non-002',
  from: 'unknown@stranger.net',
  subject: 'Hello',
  snippet: 'Hi there...',
  date: '2026-04-22T07:30:00Z',
};

// ── Mock MCP client factory ───────────────────────────────────────────────────

function makeMcpClient(toolResponses = {}) {
  return {
    callTool: jest.fn(async (toolName, _params) => {
      if (toolResponses[toolName] !== undefined) {
        const response = toolResponses[toolName];
        if (response instanceof Error) throw response;
        return response;
      }
      return null;
    }),
  };
}

// ── getRecentEmails ──────────────────────────────────────────────────────────

describe('getRecentEmails', () => {
  describe('VIP filtering', () => {
    it('returns only VIP messages when vipOnly=true (1 VIP among 3 messages)', async () => {
      const mcpClient = makeMcpClient({
        list_recent_messages: [VIP_MSG_1, NON_VIP_MSG_1, NON_VIP_MSG_2],
      });

      const result = await gmail.getRecentEmails(mcpClient, { hours: 24, vipOnly: true });

      helpers.assertSuccessShape(result);
      expect(result.data.messages).toHaveLength(1);
      expect(result.data.messages[0].id).toBe('msg-vip-001');
    });

    it('passes vipSenders to MCP as allowedSenders (D-09 server-side filter)', async () => {
      const mcpClient = makeMcpClient({
        list_recent_messages: [VIP_MSG_1],
      });

      await gmail.getRecentEmails(mcpClient, { hours: 24, vipOnly: true });

      const callArgs = mcpClient.callTool.mock.calls[0];
      expect(callArgs[0]).toBe('list_recent_messages');
      expect(callArgs[1]).toHaveProperty('allowedSenders');
      expect(callArgs[1].allowedSenders).toContain('vip@example.com');
      expect(callArgs[1].allowedSenders).toContain('boss@company.com');
    });

    it('returns all messages when vipOnly=false', async () => {
      const mcpClient = makeMcpClient({
        list_recent_messages: [VIP_MSG_1, NON_VIP_MSG_1, NON_VIP_MSG_2],
      });

      const result = await gmail.getRecentEmails(mcpClient, { hours: 24, vipOnly: false });

      helpers.assertSuccessShape(result);
      expect(result.data.messages).toHaveLength(3);
    });

    it('connector output is a subset of server response (D-10 contract)', async () => {
      const allMessages = [VIP_MSG_1, VIP_MSG_2, NON_VIP_MSG_1, NON_VIP_MSG_2, {
        id: 'msg-non-003',
        from: 'another@outsider.org',
        subject: 'Promo',
        snippet: '50% off',
        date: '2026-04-22T06:00:00Z',
      }];

      const mcpClient = makeMcpClient({
        list_recent_messages: allMessages,
      });

      const result = await gmail.getRecentEmails(mcpClient, { hours: 24, vipOnly: true });

      helpers.assertSuccessShape(result);
      // Connector output is a strict subset of server response
      expect(result.data.messages.length).toBeLessThanOrEqual(allMessages.length);
      // Every returned message is from a VIP sender (case-insensitive)
      const vipLower = ['vip@example.com', 'boss@company.com'];
      result.data.messages.forEach(msg => {
        expect(vipLower).toContain(msg.from.toLowerCase());
      });
    });

    it('applies case-insensitive VIP matching (D-10)', async () => {
      const mixedCaseVip = {
        id: 'msg-vip-caps',
        from: 'BOSS@COMPANY.COM',
        subject: 'Caps test',
        snippet: 'test',
        date: '2026-04-22T11:00:00Z',
      };

      const mcpClient = makeMcpClient({
        list_recent_messages: [mixedCaseVip, NON_VIP_MSG_1],
      });

      const result = await gmail.getRecentEmails(mcpClient, { hours: 24, vipOnly: true });

      helpers.assertSuccessShape(result);
      expect(result.data.messages).toHaveLength(1);
      expect(result.data.messages[0].id).toBe('msg-vip-caps');
    });
  });

  describe('defaults', () => {
    it('uses config defaultWindowHours when hours not provided', async () => {
      const mcpClient = makeMcpClient({
        list_recent_messages: [],
      });

      await gmail.getRecentEmails(mcpClient);

      const callArgs = mcpClient.callTool.mock.calls[0];
      expect(callArgs[1].hours).toBe(24); // config.defaultWindowHours
    });

    it('defaults vipOnly to true when not specified', async () => {
      const mcpClient = makeMcpClient({
        list_recent_messages: [VIP_MSG_1, NON_VIP_MSG_1],
      });

      const result = await gmail.getRecentEmails(mcpClient);

      helpers.assertSuccessShape(result);
      // Default vipOnly=true means non-VIP messages are filtered out
      expect(result.data.messages).toHaveLength(1);
      expect(result.data.messages[0].id).toBe('msg-vip-001');
    });

    it('passes config maxResults to MCP call', async () => {
      const mcpClient = makeMcpClient({
        list_recent_messages: [],
      });

      await gmail.getRecentEmails(mcpClient);

      const callArgs = mcpClient.callTool.mock.calls[0];
      expect(callArgs[1].maxResults).toBe(20); // config.maxResults
    });
  });

  describe('error handling', () => {
    it('returns {success: false} when MCP tool throws', async () => {
      const mcpClient = makeMcpClient({
        list_recent_messages: new Error('MCP connection failed'),
      });

      const result = await gmail.getRecentEmails(mcpClient, { hours: 24 });

      helpers.assertErrorShape(result);
      expect(result.error).toContain('MCP connection failed');
    });

    it('returns {success: false, error: "mcpClient is required"} when mcpClient is null', async () => {
      const result = await gmail.getRecentEmails(null);

      helpers.assertErrorShape(result);
      expect(result.error).toBe('mcpClient is required');
    });

    it('returns {success: false} when mcpClient is undefined', async () => {
      const result = await gmail.getRecentEmails(undefined);

      helpers.assertErrorShape(result);
      expect(result.error).toBe('mcpClient is required');
    });
  });

  describe('D-15 shape', () => {
    it('result.source is SOURCE.GMAIL', async () => {
      const mcpClient = makeMcpClient({ list_recent_messages: [] });
      const result = await gmail.getRecentEmails(mcpClient, { hours: 24, vipOnly: false });
      helpers.assertSuccessShape(result);
      expect(result.source).toBe('gmail');
    });
  });
});

// ── getEmailBody ─────────────────────────────────────────────────────────────

describe('getEmailBody', () => {
  it('returns message body in uniform shape', async () => {
    const bodyData = { id: 'msg-123', body: 'Hello, this is the full message body.' };
    const mcpClient = makeMcpClient({ get_message_body: bodyData });

    const result = await gmail.getEmailBody(mcpClient, 'msg-123');

    helpers.assertSuccessShape(result);
    expect(result.data.message).toEqual(bodyData);
    expect(result.source).toBe('gmail');
  });

  it('passes messageId to MCP call', async () => {
    const mcpClient = makeMcpClient({ get_message_body: { id: 'msg-123', body: 'content' } });

    await gmail.getEmailBody(mcpClient, 'msg-123');

    const callArgs = mcpClient.callTool.mock.calls[0];
    expect(callArgs[0]).toBe('get_message_body');
    expect(callArgs[1]).toEqual({ messageId: 'msg-123' });
  });

  it('returns {success: false} when MCP tool throws', async () => {
    const mcpClient = makeMcpClient({ get_message_body: new Error('Not found') });

    const result = await gmail.getEmailBody(mcpClient, 'msg-999');

    helpers.assertErrorShape(result);
    expect(result.error).toContain('Not found');
  });

  it('returns {success: false, error: "messageId is required"} when messageId is null', async () => {
    const mcpClient = makeMcpClient({});

    const result = await gmail.getEmailBody(mcpClient, null);

    helpers.assertErrorShape(result);
    expect(result.error).toBe('messageId is required');
  });

  it('returns {success: false} when messageId is undefined', async () => {
    const mcpClient = makeMcpClient({});

    const result = await gmail.getEmailBody(mcpClient, undefined);

    helpers.assertErrorShape(result);
    expect(result.error).toBe('messageId is required');
  });

  it('returns {success: false} when mcpClient is null', async () => {
    const result = await gmail.getEmailBody(null, 'msg-123');

    helpers.assertErrorShape(result);
    expect(result.error).toBe('mcpClient is required');
  });
});

// ── createDraft ───────────────────────────────────────────────────────────────

describe('createDraft', () => {
  it('returns draft result in uniform shape', async () => {
    const draftData = { id: 'draft-001', status: 'created' };
    const mcpClient = makeMcpClient({ create_draft: draftData });

    const result = await gmail.createDraft(mcpClient, {
      to: 'someone@example.com',
      subject: 'Test subject',
      body: 'Test body content',
    });

    helpers.assertSuccessShape(result);
    expect(result.data.draft).toEqual(draftData);
    expect(result.source).toBe('gmail');
  });

  it('passes to/subject/body to MCP call', async () => {
    const mcpClient = makeMcpClient({ create_draft: { id: 'draft-002' } });

    await gmail.createDraft(mcpClient, {
      to: 'recipient@example.com',
      subject: 'Meeting notes',
      body: 'Here are the notes...',
    });

    const callArgs = mcpClient.callTool.mock.calls[0];
    expect(callArgs[0]).toBe('create_draft');
    expect(callArgs[1]).toEqual({
      to: 'recipient@example.com',
      subject: 'Meeting notes',
      body: 'Here are the notes...',
    });
  });

  it('returns {success: false} when MCP tool throws', async () => {
    const mcpClient = makeMcpClient({ create_draft: new Error('Auth error') });

    const result = await gmail.createDraft(mcpClient, {
      to: 'someone@example.com',
      subject: 'Test',
      body: 'content',
    });

    helpers.assertErrorShape(result);
    expect(result.error).toContain('Auth error');
  });

  it('returns {success: false} when to is missing', async () => {
    const mcpClient = makeMcpClient({});

    const result = await gmail.createDraft(mcpClient, {
      subject: 'No recipient',
      body: 'content',
    });

    helpers.assertErrorShape(result);
    expect(result.error).toContain('to and subject are required');
  });

  it('returns {success: false} when subject is missing', async () => {
    const mcpClient = makeMcpClient({});

    const result = await gmail.createDraft(mcpClient, {
      to: 'someone@example.com',
      body: 'content',
    });

    helpers.assertErrorShape(result);
    expect(result.error).toContain('to and subject are required');
  });

  it('returns {success: false} when called with empty object {}', async () => {
    const mcpClient = makeMcpClient({});

    const result = await gmail.createDraft(mcpClient, {});

    helpers.assertErrorShape(result);
    expect(result.error).toContain('to and subject are required');
  });

  it('returns {success: false} when mcpClient is null', async () => {
    const result = await gmail.createDraft(null, {
      to: 'someone@example.com',
      subject: 'Test',
      body: 'content',
    });

    helpers.assertErrorShape(result);
    expect(result.error).toBe('mcpClient is required');
  });
});

// ── Security / contract tests ─────────────────────────────────────────────────

describe('security contracts', () => {
  it('exports no send functions (D-05, D-08)', () => {
    // Reload fresh module reference for contract inspection
    let gmailFresh;
    jest.isolateModules(() => {
      gmailFresh = require('../../src/connectors/gmail');
    });

    const exportedNames = Object.keys(gmailFresh);
    const sendFunctions = exportedNames.filter(name => /^send/i.test(name));
    expect(sendFunctions).toEqual([]);
  });

  it('never calls send_message MCP tool during normal operations', async () => {
    const mcpClient = makeMcpClient({
      list_recent_messages: [VIP_MSG_1],
      get_message_body: { id: 'msg-vip-001', body: 'content' },
      create_draft: { id: 'draft-001' },
    });

    // Exercise all three exported functions
    await gmail.getRecentEmails(mcpClient, { hours: 24, vipOnly: true });
    await gmail.getEmailBody(mcpClient, 'msg-vip-001');
    await gmail.createDraft(mcpClient, {
      to: 'test@example.com',
      subject: 'Test',
      body: 'content',
    });

    const allToolCalls = mcpClient.callTool.mock.calls.map(c => c[0]);
    expect(allToolCalls).not.toContain('send_message');
    expect(allToolCalls).not.toContain('send_email');
    expect(allToolCalls).not.toContain('send');
  });

  it('exports exactly getRecentEmails, getEmailBody, createDraft', () => {
    let gmailFresh;
    jest.isolateModules(() => {
      gmailFresh = require('../../src/connectors/gmail');
    });

    expect(Object.keys(gmailFresh).sort()).toEqual(
      ['createDraft', 'getEmailBody', 'getRecentEmails']
    );
  });
});
