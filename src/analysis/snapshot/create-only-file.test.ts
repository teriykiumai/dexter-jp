import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CreateOnlyFilePublicationError,
  publishCreateOnlyFile,
} from './create-only-file.js';

const temporaryDirectories: string[] = [];

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dexter-create-only-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('publishCreateOnlyFile', () => {
  test('removes its temporary file when validation fails before publication', async () => {
    const directory = await createDirectory();
    const finalPath = join(directory, 'artifact.json');
    const validationFailure = new Error('validation failed');

    await expect(publishCreateOnlyFile({
      finalPath,
      canonicalPayload: '{"value":1}',
      assertTemporaryPath: () => undefined,
      validateTemporary: async () => {
        throw validationFailure;
      },
      resolveExisting: async () => 'existing' as const,
    })).rejects.toBe(validationFailure);
    expect(await readdir(directory)).toEqual([]);
  });

  test('never replaces an existing winner when resolving EEXIST', async () => {
    const directory = await createDirectory();
    const finalPath = join(directory, 'artifact.json');
    await writeFile(finalPath, '{"winner":true}', 'utf8');
    const before = await stat(finalPath);

    const outcome = await publishCreateOnlyFile({
      finalPath,
      canonicalPayload: '{"winner":false}',
      assertTemporaryPath: () => undefined,
      validateTemporary: async temporaryPath => {
        expect(await readFile(temporaryPath, 'utf8')).toBe('{"winner":false}');
      },
      resolveExisting: async path => {
        expect(await readFile(path, 'utf8')).toBe('{"winner":true}');
        return 'existing' as const;
      },
    });

    expect(outcome).toBe('existing');
    expect(await readFile(finalPath, 'utf8')).toBe('{"winner":true}');
    expect((await stat(finalPath)).ino).toBe(before.ino);
    expect(await readdir(directory)).toEqual(['artifact.json']);
  });

  test('reports unsupported hard links without a rename or copy fallback', async () => {
    const directory = await createDirectory();
    const finalPath = join(directory, 'artifact.json');
    try {
      await publishCreateOnlyFile({
        finalPath,
        canonicalPayload: '{}',
        assertTemporaryPath: () => undefined,
        validateTemporary: async () => undefined,
        resolveExisting: async () => 'existing' as const,
        linkFile: async () => {
          throw Object.assign(new Error('unsupported'), { code: 'EXDEV' });
        },
      });
      throw new Error('Expected unsupported publication failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(CreateOnlyFilePublicationError);
      expect((error as CreateOnlyFilePublicationError).kind).toBe('publish_unsupported');
    }
    expect(await readdir(directory)).toEqual([]);
  });
});
