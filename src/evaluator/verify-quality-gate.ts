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

function gitLatestChanges(rootDirectory: string): readonly Readonly<{
  status: string;
  path: string;
}>[] {
  const result = Bun.spawnSync(['git', 'diff', '--name-status', 'HEAD^', 'HEAD'], {
    cwd: rootDirectory,
  });
  if (result.exitCode !== 0) throw new Error('Quality-gate repository diff is unavailable.');
  return new TextDecoder().decode(result.stdout).trim().split(/\r?\n/).filter(Boolean)
    .map(line => {
      const [status = '', path = ''] = line.split('\t');
      return { status, path };
    });
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
  const latestChanges = gitLatestChanges(rootDirectory);
  if (
    latestChanges.some(change => change.status === 'A' && change.path === attestationRelativePath)
    && latestChanges.some(change => change.path !== attestationRelativePath)
  ) {
    throw new Error('The qualification commit must add only its exact attestation file.');
  }
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
