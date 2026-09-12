import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { fixtureCodecs, fixtureObject, fixtureWorkspace } from './test-fixtures.js';
import { registerReferences } from './references.js';
import { json, objectKey } from './contracts.js';
import type { CatalogRow } from './repository.js';

test('10k catalog staging permits concurrent local search, preferences and Drawing saves', async () => {
  const f = await fixtureWorkspace();
  try {
    const rows: CatalogRow[] = [f.row];
    for (let index = 1; index < 10_000; index++) {
      const instrumentId = randomUUID();
      rows.push({ ...f.row, instrumentId, code: String(10000 + index), label: `Fixture ${index}`,
        evidence: fixtureObject(f.objectRoot, { kind: 'instrument-owned', instrumentId }, [f.master]) });
    }
    registerReferences(f.db, f.objectRoot, rows.map(row => row.evidence), fixtureCodecs);
    await f.repository.acceptCatalog(f.repository.requestCatalog('2026-09-11'), rows, f.master);
    f.repository.openWorkspace(f.instrumentId);
    f.repository.saveDrawing(f.drawing, 0);
    f.db.transaction(() => {
      const { basisObject, revision, ...anchors } = f.drawing;
      for (let index = 1; index < 10_000; index++) {
        const id = randomUUID();
        f.db.sqlite.run('INSERT INTO drawings VALUES (?,?,?,?,?)',
          [id, f.instrumentId, json({ ...anchors, id }), objectKey(basisObject), revision]);
      }
    });
    expect(f.repository.drawings(f.instrumentId, '', 100)).toHaveLength(100);
    const samples: Record<'search' | 'preferences' | 'save' | 'eventLoop', number[]> = {
      search: [], preferences: [], save: [], eventLoop: [],
    };
    let revision = 1;
    function measure(sample: boolean): void {
      let start = performance.now(); f.repository.search('Fixture');
      if (sample) samples.search.push(performance.now() - start);
      start = performance.now(); f.repository.preferences(f.instrumentId);
      if (sample) samples.preferences.push(performance.now() - start);
      start = performance.now(); f.repository.saveDrawing({ ...f.drawing, revision: revision + 1 }, revision++);
      if (sample) samples.save.push(performance.now() - start);
    }
    for (let index = 0; index < 20; index++) measure(false);
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      const update = f.repository.acceptCatalog(f.repository.requestCatalog('2026-09-11'), rows, f.master);
      samples.eventLoop.push(performance.now() - started);
      // A catalog chunk and one foreground operation set share each event-loop turn.
      // Completion tracking has both branches so a rejected update cannot leak a job.
      let done = false;
      void update.then(() => { done = true; }, () => { done = true; });
      while (!done) {
        const beforeYield = performance.now(); await setImmediate();
        samples.eventLoop.push(performance.now() - beforeYield);
        measure(true);
      }
      expect(await update).toBe('active');
    }
    const distribution = Object.fromEntries(Object.entries(samples).map(([operation, values]) => {
      values.sort((a, b) => a - b);
      return [operation, { count: values.length, p95Ms: values[Math.ceil(values.length * .95) - 1]!, maxMs: values.at(-1)! }];
    }));
    console.info('Workspace responsiveness fixture', JSON.stringify({ platform: process.platform,
      cpu: cpus()[0]?.model, ramGiB: totalmem() / 1024 ** 3, bun: Bun.version, sqlite: f.db.sqliteVersion,
      catalogRows: rows.length, drawings: 10_000, catalogUpdates: 5, distribution }));
    for (const key of ['search', 'preferences', 'save'] as const) {
      expect(distribution[key]!.p95Ms).toBeLessThanOrEqual(250);
      expect(distribution[key]!.maxMs).toBeLessThanOrEqual(1000);
    }
    expect(distribution.eventLoop!.maxMs).toBeLessThan(1000);
  } finally { f.dispose(); }
}, 120_000);
