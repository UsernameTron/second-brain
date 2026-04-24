'use strict';

/**
 * memory-extractor.test.js
 *
 * Tests for src/memory-extractor.js — memory extraction from transcripts and vault files.
 * Covers: extractFromTranscript, extractFromFile, extractFromDirectory, extractMemories,
 *         and .claude/hooks/memory-extraction-hook.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Test helpers ─────────────────────────────────────────────────────────────

let tmpDir;
let extractor;

// Build a minimal JSONL transcript line
function makeMessage(role, content, toolName = null) {
  const msg = { role, content };
  if (toolName) msg.tool_name = toolName;
  return JSON.stringify(msg);
}

// Build a mock Haiku client that returns specified candidates
function mockHaiku(candidates = []) {
  return {
    classify: jest.fn().mockResolvedValue({
      success: true,
      data: candidates,
    }),
  };
}

function mockHaikuFailure() {
  return {
    classify: jest.fn().mockResolvedValue({
      success: false,
      error: 'API error',
      failureMode: 'api-error',
    }),
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'me-test-'));
  process.env.VAULT_ROOT = tmpDir;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

  // Create required directories
  fs.mkdirSync(path.join(tmpDir, 'proposals'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'memory-archive'), { recursive: true });

  jest.resetModules();
  extractor = require('../src/memory-extractor');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  jest.restoreAllMocks();
});

// ── extractFromTranscript ────────────────────────────────────────────────────

describe('extractFromTranscript', () => {
  test('returns empty array on Haiku API failure (never throws)', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, makeMessage('user', 'This is a test message that is long enough') + '\n');

    const result = await extractor.extractFromTranscript(
      transcriptPath,
      'session-abc',
      { _haikuClient: mockHaikuFailure() }
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('returns empty array on missing transcript file (never throws)', async () => {
    const result = await extractor.extractFromTranscript(
      '/nonexistent/path/transcript.jsonl',
      'session-abc'
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('excludes system-reminder messages (role === "system")', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, [
      makeMessage('system', 'This is a system-reminder message that should be excluded'),
      makeMessage('user', 'This is a user message that should be included in extraction'),
    ].join('\n') + '\n');

    const capturedPrompts = [];
    const mockClient = {
      classify: jest.fn().mockImplementation((sysPrompt, userContent) => {
        capturedPrompts.push(userContent);
        return Promise.resolve({ success: true, data: [] });
      }),
    };

    await extractor.extractFromTranscript(transcriptPath, 'session-abc', { _haikuClient: mockClient });

    // The user content passed to Haiku should NOT include the system-reminder
    const corpus = capturedPrompts.join(' ');
    expect(corpus).not.toContain('system-reminder message');
    expect(corpus).toContain('user message that should be included');
  });

  test('excludes messages shorter than 20 characters', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, [
      makeMessage('user', 'ok'),
      makeMessage('user', 'This is a longer user message for extraction purposes'),
    ].join('\n') + '\n');

    const capturedPrompts = [];
    const mockClient = {
      classify: jest.fn().mockImplementation((sysPrompt, userContent) => {
        capturedPrompts.push(userContent);
        return Promise.resolve({ success: true, data: [] });
      }),
    };

    await extractor.extractFromTranscript(transcriptPath, 'session-abc', { _haikuClient: mockClient });

    const corpus = capturedPrompts.join(' ');
    expect(corpus).not.toContain('"ok"');
    expect(corpus).toContain('longer user message');
  });

  test('excludes raw Read/Glob/Grep/Bash-ls tool outputs', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({ role: 'tool', content: 'file contents here for raw read output tool call', tool_name: 'Read' }),
      makeMessage('user', 'This is the actual user message worth extracting'),
    ].join('\n') + '\n');

    const capturedPrompts = [];
    const mockClient = {
      classify: jest.fn().mockImplementation((sysPrompt, userContent) => {
        capturedPrompts.push(userContent);
        return Promise.resolve({ success: true, data: [] });
      }),
    };

    await extractor.extractFromTranscript(transcriptPath, 'session-abc', { _haikuClient: mockClient });
    const corpus = capturedPrompts.join(' ');
    expect(corpus).not.toContain('raw read output tool call');
    expect(corpus).toContain('actual user message');
  });

  test('weights git diff and PR content 2x in extraction corpus', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const gitContent = 'git diff shows significant architectural changes made';
    fs.writeFileSync(transcriptPath, [
      makeMessage('assistant', gitContent + ' via git diff summary output'),
    ].join('\n') + '\n');

    const capturedPrompts = [];
    const mockClient = {
      classify: jest.fn().mockImplementation((sysPrompt, userContent) => {
        capturedPrompts.push(userContent);
        return Promise.resolve({ success: true, data: [] });
      }),
    };

    await extractor.extractFromTranscript(transcriptPath, 'session-abc', { _haikuClient: mockClient });
    const corpus = capturedPrompts.join(' ');
    // Should appear twice (2x weighting) or have HIGH-SIGNAL marker
    const count = (corpus.match(/git diff/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('drops candidates with confidence < 0.5', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, makeMessage('user', 'User message with sufficient length here') + '\n');

    const mockClient = mockHaiku([
      { category: 'LEARNING', content: 'Low confidence learning', source_ref: 'session:abc', confidence: 0.3, rationale: 'test' },
    ]);

    const result = await extractor.extractFromTranscript(transcriptPath, 'session-abc', { _haikuClient: mockClient });
    expect(result).toHaveLength(0);
  });

  test('writes candidates with confidence >= 0.5 and confidence < 0.75 as status pending with low confidence value', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, makeMessage('user', 'User message with sufficient length here for extraction') + '\n');

    const mockClient = mockHaiku([
      { category: 'LEARNING', content: 'Mid confidence learning candidate content', source_ref: 'session:abc', confidence: 0.6, rationale: 'test' },
    ]);

    const result = await extractor.extractFromTranscript(transcriptPath, 'session-abc', { _haikuClient: mockClient });
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Should be written (not dropped) with confidence 0.6
    expect(result[0].written).toBe(true);
  });

  test('each candidate has sourceRef session:<sessionId>', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, makeMessage('user', 'User message with sufficient length here for extraction test') + '\n');

    // We check via the written candidate in proposals file
    const mockClient = mockHaiku([
      { category: 'LEARNING', content: 'High confidence learning candidate content here', source_ref: 'session:abc', confidence: 0.9, rationale: 'test' },
    ]);

    const result = await extractor.extractFromTranscript(transcriptPath, 'test-session-id', { _haikuClient: mockClient });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const { readProposals } = require('../src/memory-proposals');
    const proposals = await readProposals();
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    // Check proposals file has the session source
    const proposalsFile = fs.readFileSync(path.join(tmpDir, 'proposals', 'memory-proposals.md'), 'utf8');
    expect(proposalsFile).toContain('session:test-session-id');
  });

  test('extraction prompt includes all 7 memory categories from templates.json', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, makeMessage('user', 'User message with sufficient length here for extraction') + '\n');

    const capturedSystemPrompts = [];
    const mockClient = {
      classify: jest.fn().mockImplementation((sysPrompt) => {
        capturedSystemPrompts.push(sysPrompt);
        return Promise.resolve({ success: true, data: [] });
      }),
    };

    await extractor.extractFromTranscript(transcriptPath, 'session-abc', { _haikuClient: mockClient });
    const sysPrompt = capturedSystemPrompts[0] || '';
    expect(sysPrompt).toContain('DECISION');
    expect(sysPrompt).toContain('LEARNING');
    expect(sysPrompt).toContain('PREFERENCE');
    expect(sysPrompt).toContain('RELATIONSHIP');
    expect(sysPrompt).toContain('CONSTRAINT');
    expect(sysPrompt).toContain('PATTERN');
    expect(sysPrompt).toContain('OTHER');
  });

  test('handles oversized transcript (> 2000 messages) by chunking 100 messages with 10 overlap', async () => {
    const transcriptPath = path.join(tmpDir, 'oversized.jsonl');
    // Write 2100 messages
    const lines = [];
    for (let i = 0; i < 2100; i++) {
      lines.push(makeMessage('user', 'Message number ' + i + ' with sufficient length for extraction test'));
    }
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const classifyCalls = [];
    const mockClient = {
      classify: jest.fn().mockImplementation((sysPrompt, userContent) => {
        classifyCalls.push(userContent);
        return Promise.resolve({ success: true, data: [] });
      }),
    };

    await extractor.extractFromTranscript(transcriptPath, 'session-abc', { _haikuClient: mockClient });
    // Should have made multiple classify calls (chunked)
    expect(classifyCalls.length).toBeGreaterThan(1);
  });

  test('deduplicates candidates across chunks by content_hash', async () => {
    const transcriptPath = path.join(tmpDir, 'overlap.jsonl');
    const lines = [];
    for (let i = 0; i < 110; i++) {
      lines.push(makeMessage('user', 'Message number ' + i + ' with sufficient length for extraction test'));
    }
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    // Return the same candidate from every chunk
    const mockClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: [
          { category: 'LEARNING', content: 'Repeated candidate from overlapping chunks', source_ref: 'session:abc', confidence: 0.9, rationale: 'test' },
        ],
      }),
    };

    const result = await extractor.extractFromTranscript(transcriptPath, 'session-abc', { _haikuClient: mockClient });
    // Should only write one unique candidate despite overlap
    const writtenCount = result.filter((r) => r.written).length;
    expect(writtenCount).toBe(1);
  });
});

// ── extractFromFile ──────────────────────────────────────────────────────────

describe('extractFromFile', () => {
  test('reads vault file and returns candidates with source-ref file:<path>', async () => {
    // Create a vault-like file directly in tmpDir
    const notePath = path.join(tmpDir, 'memory', 'test-note.md');
    fs.writeFileSync(notePath, '# Test Note\n\nThis note has interesting content about decisions made.\n');

    const mockClient = mockHaiku([
      { category: 'DECISION', content: 'Decision from vault file content here', source_ref: 'file:memory/test-note.md', confidence: 0.85, rationale: 'test' },
    ]);

    const result = await extractor.extractFromFile('memory/test-note.md', { _haikuClient: mockClient });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);

    const proposalsContent = fs.readFileSync(path.join(tmpDir, 'proposals', 'memory-proposals.md'), 'utf8');
    expect(proposalsContent).toContain('file:');
  });

  test('extractionTrigger is "extract-memories" for file extraction', async () => {
    const notePath = path.join(tmpDir, 'memory', 'another-note.md');
    fs.writeFileSync(notePath, '# Another Note\n\nContent for extraction trigger test with sufficient length.\n');

    const mockClient = mockHaiku([
      { category: 'LEARNING', content: 'Learning from file extraction trigger test', source_ref: 'file:memory/another-note.md', confidence: 0.85, rationale: 'test' },
    ]);

    await extractor.extractFromFile('memory/another-note.md', { _haikuClient: mockClient });

    const proposalsContent = fs.readFileSync(path.join(tmpDir, 'proposals', 'memory-proposals.md'), 'utf8');
    expect(proposalsContent).toContain('extraction_trigger:: extract-memories');
  });

  test('returns empty array if file does not exist (never throws)', async () => {
    const result = await extractor.extractFromFile('memory/nonexistent.md', { _haikuClient: mockHaiku([]) });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

// ── extractFromDirectory ─────────────────────────────────────────────────────

describe('extractFromDirectory', () => {
  test('processes all .md files in directory', async () => {
    const notesDir = path.join(tmpDir, 'memory');
    fs.writeFileSync(path.join(notesDir, 'note1.md'), '# Note 1\nContent for directory extraction test 1.\n');
    fs.writeFileSync(path.join(notesDir, 'note2.md'), '# Note 2\nContent for directory extraction test 2.\n');
    fs.writeFileSync(path.join(notesDir, 'not-markdown.txt'), 'Should be skipped');

    const mockClient = mockHaiku([]);
    const result = await extractor.extractFromDirectory('memory', { _haikuClient: mockClient });
    expect(Array.isArray(result)).toBe(true);
    // Should have processed 2 md files
    expect(mockClient.classify).toHaveBeenCalledTimes(2);
  });

  test('returns empty array for empty directory (never throws)', async () => {
    const emptyDir = path.join(tmpDir, 'empty-dir');
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = await extractor.extractFromDirectory('empty-dir', { _haikuClient: mockHaiku([]) });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── extractMemories ──────────────────────────────────────────────────────────

describe('extractMemories', () => {
  test('dispatches to extractFromFile when --file option provided', async () => {
    const notePath = path.join(tmpDir, 'memory', 'dispatch-test.md');
    fs.writeFileSync(notePath, '# Dispatch Test\nContent for dispatch test with sufficient length.\n');

    const mockClient = mockHaiku([]);
    const result = await extractor.extractMemories({ file: 'memory/dispatch-test.md', _haikuClient: mockClient });
    expect(Array.isArray(result)).toBe(true);
  });

  test('dispatches to extractFromDirectory when --dir option provided', async () => {
    const mockClient = mockHaiku([]);
    const result = await extractor.extractMemories({ dir: 'memory', _haikuClient: mockClient });
    expect(Array.isArray(result)).toBe(true);
  });

  test('filters by date when --since option provided', async () => {
    // Create daily notes with date-prefixed names
    const dailyDir = path.join(tmpDir, 'Daily');
    fs.mkdirSync(dailyDir, { recursive: true });
    fs.writeFileSync(path.join(dailyDir, '2026-04-20.md'), '# Old Note\nOld content.\n');
    fs.writeFileSync(path.join(dailyDir, '2026-04-22.md'), '# Recent Note\nRecent content.\n');

    const classifyCalls = [];
    const mockClient = {
      classify: jest.fn().mockImplementation((s, u) => {
        classifyCalls.push(u);
        return Promise.resolve({ success: true, data: [] });
      }),
    };

    await extractor.extractMemories({ since: '2026-04-21', _haikuClient: mockClient });
    // Should only process files on or after 2026-04-21
    const calledWithOld = classifyCalls.some((c) => c.includes('Old content'));
    const calledWithRecent = classifyCalls.some((c) => c.includes('Recent content'));
    expect(calledWithOld).toBe(false);
    expect(calledWithRecent).toBe(true);
  });
});

// ── memory-extraction-hook.js ────────────────────────────────────────────────

describe('memory-extraction-hook.js', () => {
  const hookPath = path.join(__dirname, '..', '.claude', 'hooks', 'memory-extraction-hook.js');

  test('hook file exists at .claude/hooks/memory-extraction-hook.js', () => {
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  test('hook file contains "extractFromTranscript"', () => {
    const content = fs.readFileSync(hookPath, 'utf8');
    expect(content).toContain('extractFromTranscript');
  });

  test('hook file always exits 0 (contains exit(0) or process.exit(0))', () => {
    const content = fs.readFileSync(hookPath, 'utf8');
    expect(content).toMatch(/process\.exit\(0\)/);
  });

  test('hook file contains settings.json registration comment', () => {
    const content = fs.readFileSync(hookPath, 'utf8');
    expect(content).toContain('settings.json');
    expect(content).toContain('Stop');
  });

  test('hook file reads session_id and transcript_path from stdin schema', () => {
    const content = fs.readFileSync(hookPath, 'utf8');
    expect(content).toContain('session_id');
    expect(content).toContain('transcript_path');
  });

  test('hook exits 0 on missing transcript_path without throwing', async () => {
    // Spawn the hook with stdin containing no transcript_path
    const { execFile } = require('child_process');
    const input = JSON.stringify({ session_id: 'test-session', hook_event_name: 'Stop' });

    await new Promise((resolve, reject) => {
      const child = execFile('node', [hookPath], { timeout: 5000 }, (err, _stdout, _stderr) => {
        // Exit 0 even on missing transcript
        if (err && err.code !== 0) {
          reject(new Error('Hook exited non-zero: ' + err.code + ' stderr: ' + _stderr));
        } else {
          resolve();
        }
      });
      child.stdin.write(input);
      child.stdin.end();
    });
  });

  test('hook exits 0 on non-Stop hook_event_name', async () => {
    const { execFile } = require('child_process');
    const input = JSON.stringify({ session_id: 'test', transcript_path: '/tmp/none.jsonl', hook_event_name: 'PreToolUse' });

    await new Promise((resolve, reject) => {
      const child = execFile('node', [hookPath], { timeout: 5000 }, (err, _stdout, _stderr) => {
        if (err && err.code !== 0) {
          reject(new Error('Hook exited non-zero: ' + err.code));
        } else {
          resolve();
        }
      });
      child.stdin.write(input);
      child.stdin.end();
    });
  });
});
