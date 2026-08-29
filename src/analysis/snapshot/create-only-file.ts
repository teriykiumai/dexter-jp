import { randomUUID } from 'node:crypto';
import { link, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type CreateOnlyLinkFile = (
  existingPath: string,
  newPath: string,
) => Promise<void>;

export type CreateOnlyFilePublicationErrorKind =
  | 'publish_unsupported'
  | 'filesystem_error'
  | 'cleanup_failed';

export class CreateOnlyFilePublicationError extends Error {
  readonly kind: CreateOnlyFilePublicationErrorKind;
  readonly causeValue: unknown;

  constructor(kind: CreateOnlyFilePublicationErrorKind, causeValue: unknown) {
    const messages: Readonly<Record<CreateOnlyFilePublicationErrorKind, string>> = {
      publish_unsupported: 'Create-only publication is not supported by this filesystem.',
      filesystem_error: 'Create-only publication failed.',
      cleanup_failed: 'Create-only temporary-file cleanup failed.',
    };
    super(messages[kind]);
    this.name = 'CreateOnlyFilePublicationError';
    this.kind = kind;
    this.causeValue = causeValue;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export interface CreateOnlyFilePublicationOptions<ExistingOutcome extends string> {
  readonly finalPath: string;
  readonly canonicalPayload: string;
  readonly assertTemporaryPath: (temporaryPath: string) => void;
  readonly validateTemporary: (temporaryPath: string) => Promise<void>;
  readonly resolveExisting: (finalPath: string) => Promise<ExistingOutcome>;
  readonly linkFile?: CreateOnlyLinkFile;
}

export async function publishCreateOnlyFile<ExistingOutcome extends string>(
  options: CreateOnlyFilePublicationOptions<ExistingOutcome>,
): Promise<'created' | ExistingOutcome> {
  const temporaryPath = resolve(dirname(options.finalPath), `.${randomUUID()}.tmp`);
  options.assertTemporaryPath(temporaryPath);
  let result: 'created' | ExistingOutcome | undefined;
  let failure: unknown;
  try {
    await writeFile(temporaryPath, options.canonicalPayload, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await options.validateTemporary(temporaryPath);
    try {
      await (options.linkFile ?? link)(temporaryPath, options.finalPath);
      result = 'created';
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        result = await options.resolveExisting(options.finalPath);
      } else if (
        isNodeError(error)
        && (error.code === 'EXDEV' || error.code === 'EPERM' || error.code === 'ENOSYS')
      ) {
        throw new CreateOnlyFilePublicationError('publish_unsupported', error);
      } else {
        throw new CreateOnlyFilePublicationError('filesystem_error', error);
      }
    }
  } catch (error) {
    failure = error;
  }

  try {
    await rm(temporaryPath, { force: true });
  } catch (cleanupError) {
    throw new CreateOnlyFilePublicationError('cleanup_failed', {
      cleanupError,
      publicationError: failure,
    });
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) {
    throw new CreateOnlyFilePublicationError('filesystem_error', undefined);
  }
  return result;
}
