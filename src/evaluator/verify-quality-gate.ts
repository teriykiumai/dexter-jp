import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type CanonicalJsonValue,
  sha256CanonicalJsonV1,
} from '../analysis/snapshot/canonical-json.js';
import { INITIAL_QUALITY_GATE_ID } from './contracts.js';
import { verifyCurrentEvaluatorBindingsV1 } from './binding.js';
import {
  currentEvaluatorExecutionTupleV1,
  loadPendingQualityGateManifestV1,
  validateGateAttestationV1,
} from './quality-gate.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type GitNameStatusChangeV1 = Readonly<{
  status: string;
  path: string;
}>;

function gitPostGateChanges(
  rootDirectory: string,
  evaluatedCommitSha: string,
): readonly GitNameStatusChangeV1[] {
  const ancestor = Bun.spawnSync([
    'git', 'merge-base', '--is-ancestor', evaluatedCommitSha, 'HEAD',
  ], {
    cwd: rootDirectory,
  });
  if (ancestor.exitCode !== 0) {
    throw new Error('The evaluated quality-gate commit is not an ancestor of HEAD.');
  }
  const result = Bun.spawnSync([
    'git', 'diff', '--name-status', '--no-renames', evaluatedCommitSha, 'HEAD', '--',
  ], {
    cwd: rootDirectory,
  });
  if (result.exitCode !== 0) throw new Error('Quality-gate repository diff is unavailable.');
  return new TextDecoder().decode(result.stdout).trim().split(/\r?\n/).filter(Boolean)
    .map(line => {
      const separator = line.indexOf('\t');
      return separator < 0
        ? { status: line, path: '' }
        : { status: line.slice(0, separator), path: line.slice(separator + 1) };
    });
}

export function verifyPostGateRepositoryChangesV1(
  rootDirectory: string,
  evaluatedCommitSha: string,
  manifestRelativePath: string,
  attestationRelativePath: string,
): void {
  const changes = gitPostGateChanges(rootDirectory, evaluatedCommitSha);
  const permittedPaths = new Set([manifestRelativePath, attestationRelativePath]);
  if (
    !changes.some(change => change.status === 'A' && change.path === attestationRelativePath)
    || changes.some(change => change.status !== 'A' || !permittedPaths.has(change.path))
  ) {
    throw new Error(
      'The complete post-gate range may add only its pending manifest and exact attestation.',
    );
  }
}

export async function verifyTrackedQualityGateV1(
  rootDirectory: string = process.cwd(),
): Promise<'not_submitted' | 'pending' | 'passed'> {
  const manifestPath = resolve(
    rootDirectory,
    `src/evaluator/quality-gates/manifests/${INITIAL_QUALITY_GATE_ID}.json`,
  );
  const attestationPath = resolve(
    rootDirectory,
    `src/evaluator/quality-gates/attestations/${INITIAL_QUALITY_GATE_ID}.json`,
  );
  const [hasManifest, hasAttestation] = await Promise.all([
    exists(manifestPath),
    exists(attestationPath),
  ]);
  if (!hasManifest) {
    if (hasAttestation) throw new Error('A quality-gate attestation has no pending manifest.');
    return 'not_submitted';
  }
  const manifest = await loadPendingQualityGateManifestV1(rootDirectory);
  if (
    JSON.stringify(currentEvaluatorExecutionTupleV1()) !== JSON.stringify(manifest.execution)
  ) {
    throw new Error('Quality-gate verification must run on the attested execution tuple.');
  }
  await verifyCurrentEvaluatorBindingsV1(
    manifest.evaluatorSourceManifest,
    manifest.dependencyManifest,
    rootDirectory,
  );
  if (!hasAttestation) return 'pending';
  const rawAttestation = JSON.parse(await readFile(attestationPath, 'utf8')) as unknown;
  const attestation = validateGateAttestationV1(manifest, rawAttestation);
  const attestationRelativePath =
    `src/evaluator/quality-gates/attestations/${INITIAL_QUALITY_GATE_ID}.json`;
  const manifestRelativePath =
    `src/evaluator/quality-gates/manifests/${INITIAL_QUALITY_GATE_ID}.json`;
  verifyPostGateRepositoryChangesV1(
    rootDirectory,
    manifest.evaluatedCommitSha,
    manifestRelativePath,
    attestationRelativePath,
  );
  if (
    sha256CanonicalJsonV1(attestation as CanonicalJsonValue)
    !== sha256CanonicalJsonV1(rawAttestation as CanonicalJsonValue)
  ) {
    throw new Error('Quality-gate attestation canonical digest mismatch.');
  }
  return 'passed';
}

if (import.meta.main) {
  try {
    const state = await verifyTrackedQualityGateV1();
    process.stdout.write(`Evaluator quality gate: ${state}\n`);
  } catch {
    process.stderr.write('Evaluator quality-gate verification failed.\n');
    process.exitCode = 1;
  }
}
