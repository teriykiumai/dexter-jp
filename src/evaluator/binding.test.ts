import { describe, expect, test } from 'bun:test';
import {
  buildEvaluatorDependencyManifestV1,
  buildEvaluatorSourceManifestFromFilesystemV1,
  digestEvaluatorBindingV1,
} from './binding.js';

describe('Evaluator source and dependency binding', () => {
  test('uses the pinned Bun graph and hashes only its reachable external package files', async () => {
    const manifest = await buildEvaluatorDependencyManifestV1();
    expect(manifest.packages.map(value => value.packageName)).toEqual(['zod']);
    expect(manifest.packages[0]).toMatchObject({
      packageName: 'zod',
      packageVersion: '4.3.6',
      lockfilePackageKey: 'zod',
    });
    const paths = manifest.packages[0]!.files.map(value => value.packageRelativePath);
    expect(paths).toContain('package.json');
    expect(paths).toEqual([...new Set(paths)].sort());
    expect(digestEvaluatorBindingV1(manifest)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('binds execution config and the complete production/gold local closure', async () => {
    const manifest = await buildEvaluatorSourceManifestFromFilesystemV1();
    const paths = manifest.files.map(value => value.path);
    expect(paths).toEqual([...new Set(paths)].sort());
    expect(paths).toEqual(expect.arrayContaining([
      'package.json',
      'bun.lock',
      'tsconfig.json',
      'src/evaluator/cli.ts',
      'src/evaluator/provider.ts',
      'src/evaluator/runtime.ts',
      'src/evaluator/gold/harness.ts',
    ]));
  });

  test('rejects a missing or extra expected source-closure path', async () => {
    const manifest = await buildEvaluatorSourceManifestFromFilesystemV1();
    await expect(buildEvaluatorSourceManifestFromFilesystemV1(
      process.cwd(),
      manifest.files.slice(1).map(value => value.path),
    )).rejects.toThrow('source closure changed');
  });
});
