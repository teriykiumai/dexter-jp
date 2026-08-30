import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import {
  canonicalJsonV1,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
} from '../analysis/snapshot/canonical-json.js';
import {
  EvaluatorDependencyManifestV1Schema,
  EvaluatorSourceManifestV1Schema,
  type EvaluatorDependencyManifestV1,
  type EvaluatorSourceManifestV1,
} from './contracts.js';

const ENTRYPOINTS = [
  'src/evaluator/cli.ts',
  'src/evaluator/gold/harness.ts',
] as const;
const EXECUTION_CONFIG_PATHS = ['bun.lock', 'package.json', 'tsconfig.json'] as const;
const GATE_PATH_PREFIXES = [
  'src/evaluator/quality-gates/manifests/',
  'src/evaluator/quality-gates/attestations/',
] as const;

type SpawnResult = Readonly<{ exitCode: number; stdout: Uint8Array; stderr: Uint8Array }>;

function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function posixPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function runGit(rootDirectory: string, args: readonly string[]): SpawnResult {
  const result = Bun.spawnSync(['git', ...args], { cwd: rootDirectory });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function gitText(rootDirectory: string, args: readonly string[]): string {
  const result = runGit(rootDirectory, args);
  if (result.exitCode !== 0) throw new Error('Evaluator source binding Git command failed.');
  return new TextDecoder().decode(result.stdout);
}

function trackedFiles(rootDirectory: string): string[] {
  return gitText(rootDirectory, ['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .map(posixPath)
    .sort();
}

function isExecutionConfig(path: string): boolean {
  return /(^|\/)tsconfig[^/]*\.json$/.test(path)
    || /(^|\/)(?:bunfig|\.bunfig)\.toml$/.test(path)
    || /(^|\/)bun\.lockb?$/.test(path)
    || /(^|\/)package\.json$/.test(path);
}

function assertExecutionConfigSet(rootDirectory: string, files: readonly string[]): void {
  const discovered = files.filter(path => (
    isExecutionConfig(path)
  ));
  if (canonicalJsonV1(discovered) !== canonicalJsonV1([...EXECUTION_CONFIG_PATHS].sort())) {
    throw new Error('Evaluator execution configuration discovery changed.');
  }
  const untrackedConfigs = gitText(
    rootDirectory,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
  ).split('\0').filter(entry => entry.startsWith('?? '))
    .map(entry => posixPath(entry.slice(3)))
    .filter(isExecutionConfig);
  if (untrackedConfigs.length > 0) {
    throw new Error('An untracked Evaluator execution configuration is present.');
  }
}

async function assertRegularContainedFile(rootDirectory: string, path: string): Promise<string> {
  const absoluteRoot = resolve(rootDirectory);
  const absolutePath = resolve(absoluteRoot, path);
  const rel = relative(absoluteRoot, absolutePath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel === '' || rel.startsWith(sep)) {
    throw new Error('Evaluator binding path escaped the repository root.');
  }
  const info = await lstat(absolutePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('Evaluator binding only accepts regular non-link files.');
  }
  const [realRoot, realFile] = await Promise.all([realpath(absoluteRoot), realpath(absolutePath)]);
  const realRel = relative(realRoot, realFile);
  if (realRel === '..' || realRel.startsWith(`..${sep}`) || realRel.startsWith(sep)) {
    throw new Error('Evaluator binding file resolves outside the repository root.');
  }
  return absolutePath;
}

async function resolvedInputs(rootDirectory: string): Promise<readonly string[]> {
  const result = await Bun.build({
    entrypoints: ENTRYPOINTS.map(path => resolve(rootDirectory, path)),
    target: 'bun',
    format: 'esm',
    packages: 'bundle',
    metafile: true,
  });
  if (!result.success || result.logs.length > 0) {
    throw new Error('The pinned Bun resolver could not build the Evaluator closure.');
  }
  const inputs = Object.keys(result.metafile?.inputs ?? {}).map(input => {
    const absolute = resolve(rootDirectory, input);
    return posixPath(relative(rootDirectory, absolute));
  });
  const sorted = sortedUnique(inputs);
  for (const input of sorted) {
    if (!/\.(?:[cm]?[jt]sx?|json)$/.test(input)) continue;
    const source = await readFile(resolve(rootDirectory, input), 'utf8');
    if (
      /\bimport\s*\(\s*(?!["'])/.test(source)
      || /\brequire\s*\(\s*(?!["'])/.test(source)
    ) {
      throw new Error('Evaluator closure contains a non-literal dynamic import.');
    }
  }
  return sorted;
}

function isGateRecord(path: string): boolean {
  return GATE_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
}

function isNodeModulesPath(path: string): boolean {
  return path.split('/').includes('node_modules');
}

export async function buildEvaluatorSourceManifestFromGitV1(
  rootDirectory: string = process.cwd(),
): Promise<EvaluatorSourceManifestV1> {
  const status = gitText(rootDirectory, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status !== '') throw new Error('Evaluator source manifest generation requires a clean checkout.');
  const commitSha = gitText(rootDirectory, ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('Invalid Evaluator source commit.');
  const tracked = trackedFiles(rootDirectory);
  assertExecutionConfigSet(rootDirectory, tracked);
  const trackedSet = new Set(tracked);
  const inputs = await resolvedInputs(rootDirectory);
  const evaluatorFiles = tracked.filter(path => path.startsWith('src/evaluator/') && !isGateRecord(path));
  const localClosure = inputs.filter(path => !isNodeModulesPath(path));
  const paths = sortedUnique([...evaluatorFiles, ...localClosure, ...EXECUTION_CONFIG_PATHS]);
  const index = gitText(rootDirectory, ['ls-files', '--stage', '-z'])
    .split('\0')
    .filter(Boolean);
  const modeByPath = new Map(index.map(line => {
    const separator = line.indexOf('\t');
    const metadata = line.slice(0, separator).split(' ');
    return [posixPath(line.slice(separator + 1)), metadata[0] ?? ''] as const;
  }));
  for (const path of paths) {
    if (!trackedSet.has(path)) throw new Error('Evaluator source closure contains an untracked file.');
    if (modeByPath.get(path) !== '100644' && modeByPath.get(path) !== '100755') {
      throw new Error('Evaluator source closure contains a link or unsupported Git mode.');
    }
  }
  const files = paths.map(path => {
    const blob = runGit(rootDirectory, ['show', `${commitSha}:${path}`]);
    if (blob.exitCode !== 0) throw new Error('Evaluator source Git blob could not be read.');
    return { path, blobDigest: sha256Bytes(blob.stdout) };
  });
  return EvaluatorSourceManifestV1Schema.parse({
    kind: 'dexter_evaluator_source',
    version: 1,
    files,
  });
}

export async function buildEvaluatorSourceManifestFromFilesystemV1(
  rootDirectory: string = process.cwd(),
  expectedPaths?: readonly string[],
): Promise<EvaluatorSourceManifestV1> {
  const tracked = trackedFiles(rootDirectory);
  assertExecutionConfigSet(rootDirectory, tracked);
  const inputs = await resolvedInputs(rootDirectory);
  const evaluatorFiles = tracked.filter(path => path.startsWith('src/evaluator/') && !isGateRecord(path));
  const localClosure = inputs.filter(path => !isNodeModulesPath(path));
  const discovered = sortedUnique([...evaluatorFiles, ...localClosure, ...EXECUTION_CONFIG_PATHS]);
  if (expectedPaths !== undefined && canonicalJsonV1(discovered) !== canonicalJsonV1([...expectedPaths])) {
    throw new Error('Evaluator working-tree source closure changed.');
  }
  const paths = expectedPaths === undefined ? discovered : [...expectedPaths];
  const files = await Promise.all(paths.map(async path => ({
    path,
    blobDigest: sha256Bytes(await readFile(await assertRegularContainedFile(rootDirectory, path))),
  })));
  return EvaluatorSourceManifestV1Schema.parse({
    kind: 'dexter_evaluator_source', version: 1, files,
  });
}

type LockfilePackage = readonly [string, ...unknown[]];
type ParsedLockfile = Readonly<{ packages?: Readonly<Record<string, LockfilePackage>> }>;

function packageCoordinates(path: string): Readonly<{
  packageName: string;
  packageRoot: string;
  relativePath: string;
}> {
  const parts = path.split('/');
  const nodeModulesIndex = parts.lastIndexOf('node_modules');
  if (nodeModulesIndex < 0 || nodeModulesIndex + 1 >= parts.length) {
    throw new Error('Invalid Evaluator dependency path.');
  }
  const scoped = parts[nodeModulesIndex + 1]!.startsWith('@');
  const nameParts = scoped ? parts.slice(nodeModulesIndex + 1, nodeModulesIndex + 3) : parts.slice(nodeModulesIndex + 1, nodeModulesIndex + 2);
  if ((scoped && nameParts.length !== 2) || nameParts.length === 0) {
    throw new Error('Invalid scoped Evaluator dependency path.');
  }
  const packageName = nameParts.join('/');
  const rootParts = parts.slice(0, nodeModulesIndex + 1 + nameParts.length);
  return {
    packageName,
    packageRoot: rootParts.join('/'),
    relativePath: parts.slice(rootParts.length).join('/'),
  };
}

function lockfileKey(
  packages: Readonly<Record<string, LockfilePackage>>,
  packageName: string,
  packageVersion: string,
): string {
  const exact = `${packageName}@${packageVersion}`;
  const candidates = Object.entries(packages)
    .filter(([, value]) => value[0] === exact)
    .map(([key]) => key)
    .sort();
  if (candidates.length === 0) throw new Error('Evaluator dependency is absent from bun.lock.');
  return candidates.find(key => key === packageName) ?? candidates[0]!;
}

export async function buildEvaluatorDependencyManifestV1(
  rootDirectory: string = process.cwd(),
): Promise<EvaluatorDependencyManifestV1> {
  const inputs = (await resolvedInputs(rootDirectory)).filter(isNodeModulesPath);
  const lock = Bun.JSONC.parse(
    await readFile(resolve(rootDirectory, 'bun.lock'), 'utf8'),
  ) as ParsedLockfile;
  if (lock.packages === undefined) throw new Error('bun.lock packages are unavailable.');
  const grouped = new Map<string, { packageName: string; packageRoot: string; files: Set<string> }>();
  for (const input of inputs) {
    const coordinate = packageCoordinates(input);
    const group = grouped.get(coordinate.packageRoot) ?? {
      packageName: coordinate.packageName,
      packageRoot: coordinate.packageRoot,
      files: new Set<string>(),
    };
    group.files.add(coordinate.relativePath);
    group.files.add('package.json');
    grouped.set(coordinate.packageRoot, group);
  }
  const packages = await Promise.all([...grouped.values()].map(async group => {
    const packageJsonPath = await assertRegularContainedFile(rootDirectory, `${group.packageRoot}/package.json`);
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { name?: unknown; version?: unknown };
    if (packageJson.name !== group.packageName || typeof packageJson.version !== 'string') {
      throw new Error('Evaluator dependency package metadata does not match resolution.');
    }
    const files = await Promise.all(sortedUnique([...group.files]).map(async packageRelativePath => ({
      packageRelativePath,
      byteDigest: sha256Bytes(await readFile(await assertRegularContainedFile(
        rootDirectory,
        `${group.packageRoot}/${packageRelativePath}`,
      ))),
    })));
    return {
      packageName: group.packageName,
      packageVersion: packageJson.version,
      lockfilePackageKey: lockfileKey(lock.packages!, group.packageName, packageJson.version),
      files,
    };
  }));
  packages.sort((left, right) => left.packageName < right.packageName ? -1 : left.packageName > right.packageName ? 1 : 0);
  return EvaluatorDependencyManifestV1Schema.parse({
    kind: 'dexter_evaluator_dependencies', version: 1, packages,
  });
}

export function digestEvaluatorBindingV1(
  manifest: EvaluatorSourceManifestV1 | EvaluatorDependencyManifestV1,
): `sha256:${string}` {
  return sha256CanonicalJsonV1(manifest as CanonicalJsonValue);
}

export async function verifyCurrentEvaluatorBindingsV1(
  source: EvaluatorSourceManifestV1,
  dependency: EvaluatorDependencyManifestV1,
  rootDirectory: string = process.cwd(),
): Promise<void> {
  const currentSource = await buildEvaluatorSourceManifestFromFilesystemV1(
    rootDirectory,
    source.files.map(file => file.path),
  );
  if (canonicalJsonV1(currentSource as CanonicalJsonValue) !== canonicalJsonV1(source as CanonicalJsonValue)) {
    throw new Error('Evaluator source binding mismatch.');
  }
  const currentDependency = await buildEvaluatorDependencyManifestV1(rootDirectory);
  if (
    canonicalJsonV1(currentDependency as CanonicalJsonValue)
    !== canonicalJsonV1(dependency as CanonicalJsonValue)
  ) {
    throw new Error('Evaluator dependency binding mismatch.');
  }
}

export async function writeCanonicalGateRecord(
  path: string,
  value: CanonicalJsonValue,
): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${canonicalJsonV1(value)}\n`, { encoding: 'utf8', flag: 'wx' });
}
