'use strict';

/**
 * wikilink-engine.test.js
 *
 * Tests for the wikilink suggestion engine:
 *   - Vault index cache: buildVaultIndex, loadVaultIndex, refreshIndexEntry
 *   - Hybrid wikilink pipeline: suggestWikilinks
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Test isolation setup ─────────────────────────────────────────────────────

let tmpDir;
let tmpCacheDir;
let originalVaultRoot;
let originalConfigDir;
let originalCacheDir;

beforeAll(() => {
  // Create temporary directories for test isolation
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikilink-test-vault-'));
  tmpCacheDir = path.join(tmpDir, '.cache');
  fs.mkdirSync(tmpCacheDir, { recursive: true });

  // Set env vars BEFORE requiring the module
  originalVaultRoot = process.env.VAULT_ROOT;
  originalConfigDir = process.env.CONFIG_DIR_OVERRIDE;
  originalCacheDir = process.env.CACHE_DIR_OVERRIDE;

  process.env.VAULT_ROOT = tmpDir;
  process.env.CACHE_DIR_OVERRIDE = tmpCacheDir;

  // Create a minimal vault-paths.json for config loading
  const configDir = path.join(tmpDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  process.env.CONFIG_DIR_OVERRIDE = configDir;

  fs.writeFileSync(path.join(configDir, 'vault-paths.json'), JSON.stringify({
    left: ['ABOUT ME', 'Daily'],
    right: ['memory', 'briefings', 'proposals'],
    haikuContextChars: 100,
  }));
  fs.writeFileSync(path.join(configDir, 'excluded-terms.json'), JSON.stringify(['ISPN', 'Genesys']));
  fs.writeFileSync(path.join(configDir, 'pipeline.json'), JSON.stringify({
    classifier: { stage1ConfidenceThreshold: 0.8, stage2ConfidenceThreshold: 0.7, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
    extraction: { confidenceAccept: 0.75, confidenceLowConfidence: 0.5, chunkSize: 100, chunkOverlap: 10, oversizeThresholdBytes: 5242880, oversizeThresholdMessages: 2000 },
    wikilink: { relevanceThreshold: 0.6, maxSuggestions: 5, minSuggestions: 3, candidatePoolSize: 20 },
    promotion: { batchCapMax: 10, batchCapMin: 5, archiveEntriesThreshold: 500, archiveSizeThresholdKB: 200, proposalArchiveThreshold: 100 },
    retry: { delayMinutes: 15, maxAttempts: 3 },
    leftProposal: { autoArchiveDays: 14 },
    filename: { maxLength: 60, haikuWordRange: [4, 8] },
  }));

  // Create vault directory structure
  const dirs = ['ABOUT ME', 'Daily', 'memory', 'briefings', 'proposals'];
  for (const d of dirs) {
    fs.mkdirSync(path.join(tmpDir, d), { recursive: true });
  }
  // proposals sub-dirs
  fs.mkdirSync(path.join(tmpDir, 'proposals', 'left-proposals'), { recursive: true });
});

afterAll(() => {
  // Restore env
  if (originalVaultRoot === undefined) delete process.env.VAULT_ROOT;
  else process.env.VAULT_ROOT = originalVaultRoot;

  if (originalConfigDir === undefined) delete process.env.CONFIG_DIR_OVERRIDE;
  else process.env.CONFIG_DIR_OVERRIDE = originalConfigDir;

  if (originalCacheDir === undefined) delete process.env.CACHE_DIR_OVERRIDE;
  else process.env.CACHE_DIR_OVERRIDE = originalCacheDir;

  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: create a test note in the tmp vault
function createNote(relativePath, content) {
  const absPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}

// Helper: get fresh module (clear require cache)
function requireFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

// ── Index tests ──────────────────────────────────────────────────────────────

describe('vault index — buildVaultIndex', () => {
  beforeEach(() => {
    // Clear cache file before each test
    const cacheFile = path.join(tmpCacheDir, 'vault-index.json');
    if (fs.existsSync(cacheFile)) fs.rmSync(cacheFile);
  });

  test('scans vault directories and produces array with required keys', async () => {
    createNote('memory/test-note.md', '---\ntitle: Test Note\ntags:\n  - productivity\n---\n\nFirst line of content here.');
    const { buildVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await buildVaultIndex();
    expect(Array.isArray(index)).toBe(true);
    const entry = index.find(e => e.path === 'memory/test-note.md');
    expect(entry).toBeDefined();
    expect(entry).toHaveProperty('path');
    expect(entry).toHaveProperty('title');
    expect(entry).toHaveProperty('firstLine');
    expect(entry).toHaveProperty('tags');
  });

  test('extracts title from frontmatter when present', async () => {
    createNote('memory/frontmatter-note.md', '---\ntitle: My Custom Title\ntags: []\n---\n\nContent body.');
    const { buildVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await buildVaultIndex();
    const entry = index.find(e => e.path === 'memory/frontmatter-note.md');
    expect(entry).toBeDefined();
    expect(entry.title).toBe('My Custom Title');
  });

  test('falls back to filename (without extension) when no frontmatter title', async () => {
    createNote('memory/filename-fallback.md', '\nContent without frontmatter.');
    const { buildVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await buildVaultIndex();
    const entry = index.find(e => e.path === 'memory/filename-fallback.md');
    expect(entry).toBeDefined();
    expect(entry.title).toBe('filename-fallback');
  });

  test('extracts tags from YAML frontmatter', async () => {
    createNote('memory/tagged-note.md', '---\ntitle: Tagged\ntags:\n  - ai\n  - productivity\n---\n\nTagged content.');
    const { buildVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await buildVaultIndex();
    const entry = index.find(e => e.path === 'memory/tagged-note.md');
    expect(entry).toBeDefined();
    expect(Array.isArray(entry.tags)).toBe(true);
    expect(entry.tags).toContain('ai');
    expect(entry.tags).toContain('productivity');
  });

  test('returns empty tags array when no tags in frontmatter', async () => {
    createNote('memory/no-tags.md', '---\ntitle: No Tags\n---\n\nContent here.');
    const { buildVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await buildVaultIndex();
    const entry = index.find(e => e.path === 'memory/no-tags.md');
    expect(entry).toBeDefined();
    expect(Array.isArray(entry.tags)).toBe(true);
    expect(entry.tags).toHaveLength(0);
  });

  test('excludes files in proposals/ directory from index', async () => {
    createNote('proposals/some-proposal.md', '---\ntitle: Proposal\n---\n\nThis is a proposal.');
    const { buildVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await buildVaultIndex();
    const proposalEntry = index.find(e => e.path.startsWith('proposals/'));
    expect(proposalEntry).toBeUndefined();
  });

  test('writes result to .cache/vault-index.json', async () => {
    createNote('memory/cache-write-test.md', '---\ntitle: Cache Write Test\n---\n\nTesting cache write.');
    const { buildVaultIndex } = requireFresh('../src/wikilink-engine');
    await buildVaultIndex();
    const cacheFile = path.join(tmpCacheDir, 'vault-index.json');
    expect(fs.existsSync(cacheFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    expect(Array.isArray(parsed)).toBe(true);
  });

  test('firstLine is capped at 200 chars', async () => {
    const longContent = '---\ntitle: Long Line\n---\n\n' + 'A'.repeat(300);
    createNote('memory/long-line.md', longContent);
    const { buildVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await buildVaultIndex();
    const entry = index.find(e => e.path === 'memory/long-line.md');
    expect(entry).toBeDefined();
    expect(entry.firstLine.length).toBeLessThanOrEqual(200);
  });
});

describe('vault index — loadVaultIndex', () => {
  test('reads and returns parsed array from cache file', async () => {
    const mockIndex = [{ path: 'memory/note.md', title: 'Note', firstLine: 'Content', tags: [] }];
    fs.writeFileSync(path.join(tmpCacheDir, 'vault-index.json'), JSON.stringify(mockIndex), 'utf8');
    const { loadVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await loadVaultIndex();
    expect(Array.isArray(index)).toBe(true);
    expect(index).toHaveLength(1);
    expect(index[0].path).toBe('memory/note.md');
  });

  test('returns empty array if cache file missing (graceful degradation)', async () => {
    const cacheFile = path.join(tmpCacheDir, 'vault-index.json');
    if (fs.existsSync(cacheFile)) fs.rmSync(cacheFile);
    const { loadVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await loadVaultIndex();
    expect(Array.isArray(index)).toBe(true);
    expect(index).toHaveLength(0);
  });

  test('returns empty array on corrupt cache file (graceful degradation)', async () => {
    fs.writeFileSync(path.join(tmpCacheDir, 'vault-index.json'), 'not-valid-json', 'utf8');
    const { loadVaultIndex } = requireFresh('../src/wikilink-engine');
    const index = await loadVaultIndex();
    expect(Array.isArray(index)).toBe(true);
    expect(index).toHaveLength(0);
  });
});

describe('vault index — refreshIndexEntry', () => {
  beforeEach(() => {
    const cacheFile = path.join(tmpCacheDir, 'vault-index.json');
    if (fs.existsSync(cacheFile)) fs.rmSync(cacheFile);
  });

  test('updates existing entry in the index', async () => {
    // Create initial index with old entry
    const initialIndex = [
      { path: 'memory/refresh-me.md', title: 'Old Title', firstLine: 'Old content', tags: [] },
      { path: 'memory/other.md', title: 'Other', firstLine: 'Other content', tags: [] },
    ];
    fs.writeFileSync(path.join(tmpCacheDir, 'vault-index.json'), JSON.stringify(initialIndex), 'utf8');

    // Update the note on disk
    createNote('memory/refresh-me.md', '---\ntitle: New Title\ntags:\n  - updated\n---\n\nNew content line.');

    const { refreshIndexEntry } = requireFresh('../src/wikilink-engine');
    await refreshIndexEntry('memory/refresh-me.md');

    const updatedCache = JSON.parse(fs.readFileSync(path.join(tmpCacheDir, 'vault-index.json'), 'utf8'));
    const entry = updatedCache.find(e => e.path === 'memory/refresh-me.md');
    expect(entry).toBeDefined();
    expect(entry.title).toBe('New Title');
    expect(entry.tags).toContain('updated');
    // Other entry should remain
    expect(updatedCache.find(e => e.path === 'memory/other.md')).toBeDefined();
  });

  test('adds new entry if path not already in index', async () => {
    // Create initial index without the new file
    const initialIndex = [
      { path: 'memory/existing.md', title: 'Existing', firstLine: 'Existing content', tags: [] },
    ];
    fs.writeFileSync(path.join(tmpCacheDir, 'vault-index.json'), JSON.stringify(initialIndex), 'utf8');

    // Create new note
    createNote('memory/brand-new.md', '---\ntitle: Brand New Note\ntags:\n  - new\n---\n\nNew note content.');

    const { refreshIndexEntry } = requireFresh('../src/wikilink-engine');
    await refreshIndexEntry('memory/brand-new.md');

    const updatedCache = JSON.parse(fs.readFileSync(path.join(tmpCacheDir, 'vault-index.json'), 'utf8'));
    const newEntry = updatedCache.find(e => e.path === 'memory/brand-new.md');
    expect(newEntry).toBeDefined();
    expect(newEntry.title).toBe('Brand New Note');
    // Existing entry should remain
    expect(updatedCache.find(e => e.path === 'memory/existing.md')).toBeDefined();
  });

  test('writes updated index back to .cache/vault-index.json', async () => {
    createNote('memory/write-back.md', '---\ntitle: Write Back\n---\n\nContent.');
    const { refreshIndexEntry } = requireFresh('../src/wikilink-engine');
    await refreshIndexEntry('memory/write-back.md');
    const cacheFile = path.join(tmpCacheDir, 'vault-index.json');
    expect(fs.existsSync(cacheFile)).toBe(true);
  });
});

// ── Suggestion pipeline tests ────────────────────────────────────────────────

describe('suggestWikilinks — core pipeline', () => {
  let mockHaikuClient;

  beforeEach(() => {
    // Pre-populate cache with test notes
    const testIndex = [
      { path: 'memory/artificial-intelligence.md', title: 'Artificial Intelligence', firstLine: 'AI systems and machine learning models', tags: ['ai', 'technology'] },
      { path: 'memory/career-strategy.md', title: 'Career Strategy', firstLine: 'Career planning and professional development strategies', tags: ['career', 'strategy'] },
      { path: 'memory/daily-routine.md', title: 'Daily Routine', firstLine: 'Morning habits and productivity practices', tags: ['productivity', 'habits'] },
      { path: 'briefings/meeting-notes.md', title: 'Meeting Notes', firstLine: 'Meeting with stakeholders about AI transformation', tags: ['meetings', 'ai'] },
      { path: 'memory/project-management.md', title: 'Project Management', firstLine: 'Managing complex projects with multiple stakeholders', tags: ['projects', 'management'] },
    ];
    fs.writeFileSync(path.join(tmpCacheDir, 'vault-index.json'), JSON.stringify(testIndex), 'utf8');
  });

  test('returns object with section and links keys', async () => {
    // Mock createHaikuClient by controlling the module
    jest.mock('../src/pipeline-infra', () => ({
      ...jest.requireActual('../src/pipeline-infra'),
      createHaikuClient: () => ({
        classify: async () => ({
          success: true,
          data: [
            { path: 'memory/artificial-intelligence.md', relevance: 0.9, reason: 'Directly related to AI topic' },
          ],
        }),
      }),
    }));

    const { suggestWikilinks } = requireFresh('../src/wikilink-engine');
    const result = await suggestWikilinks('This note is about artificial intelligence and AI systems.', ['ai']);
    expect(result).toHaveProperty('section');
    expect(result).toHaveProperty('links');
    expect(typeof result.section).toBe('string');
    expect(Array.isArray(result.links)).toBe(true);

    jest.unmock('../src/pipeline-infra');
  });

  test('returns ## Related section for RIGHT notes (non-left-proposal)', async () => {
    jest.mock('../src/pipeline-infra', () => ({
      ...jest.requireActual('../src/pipeline-infra'),
      createHaikuClient: () => ({
        classify: async () => ({
          success: true,
          data: [
            { path: 'memory/artificial-intelligence.md', relevance: 0.85, reason: 'Core AI topic connection' },
          ],
        }),
      }),
    }));

    const { suggestWikilinks } = requireFresh('../src/wikilink-engine');
    const result = await suggestWikilinks('AI transformation and machine learning strategies.', ['ai']);
    expect(result.section).toContain('## Related');
    expect(result.section).not.toContain('## Suggested wikilinks');

    jest.unmock('../src/pipeline-infra');
  });

  test('returns ## Suggested wikilinks section for LEFT proposals (isLeftProposal=true)', async () => {
    jest.mock('../src/pipeline-infra', () => ({
      ...jest.requireActual('../src/pipeline-infra'),
      createHaikuClient: () => ({
        classify: async () => ({
          success: true,
          data: [
            { path: 'memory/career-strategy.md', relevance: 0.75, reason: 'Career planning related topic' },
          ],
        }),
      }),
    }));

    const { suggestWikilinks } = requireFresh('../src/wikilink-engine');
    const result = await suggestWikilinks('My thoughts on career development and growth.', ['career'], { isLeftProposal: true });
    expect(result.section).toContain('## Suggested wikilinks');
    expect(result.section).not.toContain('## Related');

    jest.unmock('../src/pipeline-infra');
  });

  test('returns empty result when no candidates meet threshold', async () => {
    jest.mock('../src/pipeline-infra', () => ({
      ...jest.requireActual('../src/pipeline-infra'),
      createHaikuClient: () => ({
        classify: async () => ({
          success: true,
          data: [
            { path: 'memory/artificial-intelligence.md', relevance: 0.3, reason: 'Weakly related' },
            { path: 'memory/career-strategy.md', relevance: 0.2, reason: 'Not related' },
          ],
        }),
      }),
    }));

    const { suggestWikilinks } = requireFresh('../src/wikilink-engine');
    const result = await suggestWikilinks('Some completely unrelated content about cooking recipes.', []);
    expect(result.section).toBe('');
    expect(result.links).toHaveLength(0);

    jest.unmock('../src/pipeline-infra');
  });

  test('caps suggestions at maxSuggestions (5) from pipeline config', async () => {
    // Build a larger index
    const largeIndex = Array.from({ length: 25 }, (_, i) => ({
      path: `memory/note-${i}.md`,
      title: `AI Note ${i} artificial intelligence`,
      firstLine: `Content about AI and machine learning topic ${i}`,
      tags: ['ai'],
    }));
    fs.writeFileSync(path.join(tmpCacheDir, 'vault-index.json'), JSON.stringify(largeIndex), 'utf8');

    jest.mock('../src/pipeline-infra', () => ({
      ...jest.requireActual('../src/pipeline-infra'),
      createHaikuClient: () => ({
        classify: async () => ({
          success: true,
          data: Array.from({ length: 25 }, (_, i) => ({
            path: `memory/note-${i}.md`,
            relevance: 0.9 - i * 0.01,
            reason: `Connection reason ${i} words here`,
          })),
        }),
      }),
    }));

    const { suggestWikilinks } = requireFresh('../src/wikilink-engine');
    const result = await suggestWikilinks('AI artificial intelligence machine learning content.', ['ai']);
    expect(result.links.length).toBeLessThanOrEqual(5);

    jest.unmock('../src/pipeline-infra');
  });

  test('formats links as [[Note Title]] — reason', async () => {
    jest.mock('../src/pipeline-infra', () => ({
      ...jest.requireActual('../src/pipeline-infra'),
      createHaikuClient: () => ({
        classify: async () => ({
          success: true,
          data: [
            { path: 'memory/artificial-intelligence.md', relevance: 0.8, reason: 'AI systems directly related topic' },
          ],
        }),
      }),
    }));

    const { suggestWikilinks } = requireFresh('../src/wikilink-engine');
    const result = await suggestWikilinks('Note about artificial intelligence AI systems.', ['ai']);
    expect(result.section).toContain('[[');
    expect(result.section).toContain(']]');
    expect(result.section).toContain('—');

    jest.unmock('../src/pipeline-infra');
  });

  test('returns empty result gracefully when vault index is empty', async () => {
    fs.writeFileSync(path.join(tmpCacheDir, 'vault-index.json'), JSON.stringify([]), 'utf8');

    const { suggestWikilinks } = requireFresh('../src/wikilink-engine');
    const result = await suggestWikilinks('Any content here.', ['tag']);
    expect(result.section).toBe('');
    expect(result.links).toHaveLength(0);
  });

  test('gracefully degrades on Haiku re-rank failure (returns filename-match results)', async () => {
    // Restore index with good matches
    const testIndex = [
      { path: 'memory/artificial-intelligence.md', title: 'Artificial Intelligence', firstLine: 'AI systems and machine learning', tags: ['ai'] },
    ];
    fs.writeFileSync(path.join(tmpCacheDir, 'vault-index.json'), JSON.stringify(testIndex), 'utf8');

    jest.mock('../src/pipeline-infra', () => ({
      ...jest.requireActual('../src/pipeline-infra'),
      createHaikuClient: () => ({
        classify: async () => ({
          success: false,
          error: 'API error',
          failureMode: 'api-error',
        }),
      }),
    }));

    const { suggestWikilinks } = requireFresh('../src/wikilink-engine');
    // Should not throw — enrichment failures never block per D-39
    const result = await suggestWikilinks('Content about artificial intelligence AI.', ['ai']);
    expect(result).toHaveProperty('section');
    expect(result).toHaveProperty('links');
    // On fallback, may return empty or filename-match results — must not throw
    expect(Array.isArray(result.links)).toBe(true);

    jest.unmock('../src/pipeline-infra');
  });
});
