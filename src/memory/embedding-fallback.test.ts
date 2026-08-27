import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryDatabase } from './database.js';
import { MemoryIndexer } from './indexer.js';
import { hybridSearch } from './search.js';
import { MemoryStore } from './store.js';
import type { MemoryEmbeddingClient } from './types.js';

const tempDirs: string[] = [];

const searchDefaults = {
  maxResults: 6,
  minScore: 0,
  vectorWeight: 0.7,
  textWeight: 0.3,
};

async function createKeywordDatabase(): Promise<{
  baseDir: string;
  db: MemoryDatabase;
}> {
  const baseDir = await mkdtemp(join(tmpdir(), 'dexter-memory-fallback-'));
  tempDirs.push(baseDir);
  const store = new MemoryStore(baseDir);
  await store.writeMemoryFile('MEMORY.md', 'alpha investment preference');
  const db = await MemoryDatabase.create(join(baseDir, 'index.sqlite'));
  const indexer = new MemoryIndexer(store, db, {
    chunkTokens: 400,
    overlapTokens: 80,
    watchDebounceMs: 1500,
    embeddingClient: null,
    indexSessions: false,
  });
  await indexer.sync();
  return { baseDir, db };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('memory embedding fallback', () => {
  test('keeps indexing keyword-searchable content and stops retrying after embedding failure', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'dexter-memory-indexer-'));
    tempDirs.push(baseDir);
    const store = new MemoryStore(baseDir);
    await store.writeMemoryFile('MEMORY.md', 'alpha investment preference');
    const db = await MemoryDatabase.create(join(baseDir, 'index.sqlite'));
    let embedCalls = 0;
    let degradedCalls = 0;
    const client: MemoryEmbeddingClient = {
      provider: 'openai',
      model: 'text-embedding-3-small',
      embed: async () => {
        embedCalls += 1;
        throw new Error('403 Project proj_secret does not have access');
      },
    };

    try {
      const indexer = new MemoryIndexer(store, db, {
        chunkTokens: 400,
        overlapTokens: 80,
        watchDebounceMs: 1500,
        embeddingClient: client,
        indexSessions: false,
        onEmbeddingUnavailable: () => {
          degradedCalls += 1;
        },
      });

      await expect(indexer.sync()).resolves.toMatchObject({ indexedChunks: 1 });
      expect(db.searchKeyword('alpha', 10)).toHaveLength(1);
      expect(embedCalls).toBe(1);
      expect(degradedCalls).toBe(1);

      indexer.markDirty();
      await indexer.sync();
      expect(embedCalls).toBe(1);
      expect(degradedCalls).toBe(1);
    } finally {
      db.close();
    }
  });

  test('returns keyword results with a typed degradation when query embedding fails', async () => {
    const { db } = await createKeywordDatabase();
    let degradedCalls = 0;
    const client: MemoryEmbeddingClient = {
      provider: 'openai',
      model: 'text-embedding-3-small',
      embed: async () => {
        throw new Error('403 Project proj_secret does not have access');
      },
    };

    try {
      const outcome = await hybridSearch({
        db,
        embeddingClient: client,
        query: 'alpha',
        defaults: searchDefaults,
        onEmbeddingUnavailable: () => {
          degradedCalls += 1;
        },
      });

      expect(outcome.searchMode).toBe('keyword_only');
      expect(outcome.degraded).toEqual({ reason: 'embedding_unavailable' });
      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0]?.source).toBe('keyword');
      expect(degradedCalls).toBe(1);
      expect(JSON.stringify(outcome)).not.toContain('proj_secret');

      const emptyOutcome = await hybridSearch({
        db,
        embeddingClient: { ...client, embed: async () => [] },
        query: 'alpha',
        defaults: searchDefaults,
      });
      expect(emptyOutcome.searchMode).toBe('keyword_only');
      expect(emptyOutcome.degraded).toEqual({ reason: 'embedding_unavailable' });
    } finally {
      db.close();
    }
  });

  test('distinguishes intentional keyword-only search from embedding degradation', async () => {
    const { db } = await createKeywordDatabase();

    try {
      const outcome = await hybridSearch({
        db,
        embeddingClient: null,
        query: 'alpha',
        defaults: searchDefaults,
      });

      expect(outcome.searchMode).toBe('keyword_only');
      expect(outcome.degraded).toBeUndefined();
      expect(outcome.results).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test('preserves hybrid mode and does not swallow database failures', async () => {
    const client: MemoryEmbeddingClient = {
      provider: 'openai',
      model: 'text-embedding-3-small',
      embed: async () => [[0.5]],
    };
    const hybridDb = {
      searchVector: () => [{ chunkId: 1, score: 0.9 }],
      searchKeyword: () => [],
      loadResultsByIds: () => [{
        snippet: 'alpha',
        path: 'MEMORY.md',
        startLine: 1,
        endLine: 1,
        score: 0,
        source: 'vector' as const,
      }],
    } as unknown as MemoryDatabase;

    const hybridOutcome = await hybridSearch({
      db: hybridDb,
      embeddingClient: client,
      query: 'alpha',
      defaults: searchDefaults,
    });
    expect(hybridOutcome.searchMode).toBe('hybrid');
    expect(hybridOutcome.degraded).toBeUndefined();
    expect(hybridOutcome.results[0]?.source).toBe('vector');

    const failingDb = {
      searchKeyword: () => {
        throw new Error('database failed');
      },
    } as unknown as MemoryDatabase;
    await expect(hybridSearch({
      db: failingDb,
      embeddingClient: null,
      query: 'alpha',
      defaults: searchDefaults,
    })).rejects.toThrow('database failed');
  });
});
