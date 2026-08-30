import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { verifyPostGateRepositoryChangesV1 } from './verify-quality-gate.js';

const directories: string[] = [];
const manifestPath = 'src/evaluator/quality-gates/manifests/qg_v1_terra_high.json';
const attestationPath = 'src/evaluator/quality-gates/attestations/qg_v1_terra_high.json';

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function git(root: string, ...args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function commitAll(root: string, message: string): void {
  git(root, 'add', '--all');
  git(root, 'commit', '--no-gpg-sign', '-m', message);
}

async function repository(): Promise<Readonly<{ root: string; evaluatedCommitSha: string }>> {
  const root = await mkdtemp(join(tmpdir(), 'dexter-post-gate-'));
  directories.push(root);
  git(root, 'init');
  git(root, 'config', 'user.name', 'Dexter Test');
  git(root, 'config', 'user.email', 'dexter-test@example.invalid');
  await writeFile(join(root, 'baseline.txt'), 'evaluated\n');
  commitAll(root, 'evaluated source');
  return { root, evaluatedCommitSha: git(root, 'rev-parse', 'HEAD') };
}

async function addTrackedFile(root: string, relativePath: string, contents: string): Promise<void> {
  const path = join(root, ...relativePath.split('/'));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

describe('Evaluator post-gate repository range', () => {
  test('rejects an earlier unrelated commit when HEAD adds only the attestation', async () => {
    const state = await repository();
    await addTrackedFile(state.root, 'unrelated.txt', 'outside the reviewed lifecycle\n');
    commitAll(state.root, 'unrelated post-gate change');
    await addTrackedFile(state.root, attestationPath, '{}\n');
    commitAll(state.root, 'add attestation only');

    expect(() => verifyPostGateRepositoryChangesV1(
      state.root,
      state.evaluatedCommitSha,
      manifestPath,
      attestationPath,
    )).toThrow('complete post-gate range');
  });

  test('allows only the pending-manifest and attestation additions across the full range', async () => {
    const state = await repository();
    await addTrackedFile(state.root, manifestPath, '{}\n');
    commitAll(state.root, 'add pending manifest');
    await addTrackedFile(state.root, attestationPath, '{}\n');
    commitAll(state.root, 'add attestation only');

    expect(() => verifyPostGateRepositoryChangesV1(
      state.root,
      state.evaluatedCommitSha,
      manifestPath,
      attestationPath,
    )).not.toThrow();
  });
});
