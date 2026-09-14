import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { WorkspaceAiJobs } from './ai-jobs.js';
import { syntheticAiModel, syntheticAiOutput } from './ai-test-fixtures.js';

if (import.meta.main) {
  const [root, instrumentId, phase] = process.argv.slice(2);
  const db = new WorkspaceDatabase(root!); let calls = 0;
  const jobs = new WorkspaceAiJobs(new WorkspaceRepository(db), syntheticAiModel(async input => { calls++; return syntheticAiOutput(input); }), async (current, id) => {
    if (current === phase) { await Bun.write(Bun.stdout, `${JSON.stringify({ id, calls })}\n`); await new Promise(() => {}); }
  });
  const keepAlive = setInterval(() => {}, 1000);
  const job = await jobs.start(instrumentId!, 'fundamental'); await jobs.wait(job.id); clearInterval(keepAlive); db.close();
}
