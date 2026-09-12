import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { workspaceDataFixture } from './data-test-fixtures.js';
import { objectRow, rowRef } from './references.js';
import { json, type StoredDrawing } from './contracts.js';

test('ten-year EOD ingestion with 10000 saved Drawings keeps foreground responsive', async () => {
  const f = await workspaceDataFixture(undefined, true);
  try {
    await f.jobs.wait(await f.jobs.start('catalog')); const item = f.repository.search('7203')[0]!;
    f.repository.openWorkspace(item.instrumentId);
    const evidence = f.db.sqlite.query<{ evidence: string }, []>('SELECT evidence FROM catalog_rows LIMIT 1').get()!.evidence;
    const drawing: StoredDrawing = { id: randomUUID(), instrumentId: item.instrumentId, kind: 'horizontal', price: 100,
      time: '2026-09-11', evidenceFrom: '2026-09-11', evidenceThrough: '2026-09-11', basisObject: rowRef(objectRow(f.db, evidence)), revision: 1 };
    const { basisObject: _basis, revision: _revision, ...anchors } = drawing;
    f.db.transaction(() => {
      for (let i = 0; i < 10000; i++) {
        const id = i ? randomUUID() : drawing.id;
        f.db.sqlite.run('INSERT INTO drawings VALUES (?,?,?,?,1)', [id, item.instrumentId, json({ ...anchors, id }), evidence]);
      }
    });
    const loop: number[] = [], save: number[] = [], search: number[] = [];
    for (let repetition = 0; repetition < 2; repetition++) {
      f.advance(); let done = false;
      const job = (async () => f.jobs.wait(await f.jobs.start('technical', item.instrumentId)))();
      void job.then(() => { done = true; }, () => { done = true; });
      while (!done) {
        let start = performance.now(); await setImmediate(); loop.push(performance.now() - start);
        start = performance.now(); f.repository.search('7203'); search.push(performance.now() - start);
        start = performance.now(); f.repository.saveDrawing({ ...drawing, revision: drawing.revision + 1 }, drawing.revision);
        drawing.revision++; save.push(performance.now() - start);
      }
      expect((await job).state).toBe('published');
    }
    const stats = (values: number[]) => { values.sort((a, b) => a - b); return { count: values.length, p95: values[Math.ceil(values.length * .95) - 1]!, max: values.at(-1)! }; };
    const report = { platform: process.platform, cpu: cpus()[0]?.model, ramGiB: totalmem() / 1024 ** 3,
      bun: Bun.version, sqlite: f.db.sqliteVersion, dailyYears: 10, drawings: 10000, repetitions: 2,
      eventLoop: stats(loop), save: stats(save), search: stats(search) };
    console.info('Workspace EOD responsiveness', JSON.stringify(report));
    expect(loop.length).toBeGreaterThan(0); expect(report.eventLoop.max).toBeLessThan(1000);
    for (const result of [report.save, report.search]) { expect(result.p95).toBeLessThanOrEqual(250); expect(result.max).toBeLessThanOrEqual(1000); }
  } finally { f.dispose(); }
}, 300_000);
