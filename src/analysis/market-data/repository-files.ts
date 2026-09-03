import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { parseStrictJsonBytesV1 } from '../strategy-validation/strict-json.js';
import { failMarketData, MarketDataRepositoryErrorV1 } from './contracts.js';

export const MARKET_DATA_RECOVERY_LIMITS_V1 = Object.freeze({ receipts: 256, bytes: 256 * 1024 * 1024, milliseconds: 2000 });
export const MARKET_DATA_PRIVATE_TEMP_PATTERN_V1 = /^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
export function nodeErrorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}
export class MarketDataRecoveryBudgetV1 {
  receipts = 0;
  bytes = 0;
  private readonly started: number;
  constructor(private readonly now: () => number) { this.started = now(); this.check(); }
  check(): void {
    const elapsed = this.now() - this.started;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= MARKET_DATA_RECOVERY_LIMITS_V1.milliseconds
      || this.receipts > MARKET_DATA_RECOVERY_LIMITS_V1.receipts || this.bytes > MARKET_DATA_RECOVERY_LIMITS_V1.bytes) {
      failMarketData('artifact_recovery_bound_exceeded');
    }
  }
  inspect(): void { this.receipts++; this.check(); }
  consume(bytes: number): void { this.bytes += bytes; this.check(); }
}

/** Contains only filesystem mechanics. Module schemas/identities remain in the codec. */
export class MarketDataFilesV1 {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  contained(path: string): void {
    const child = relative(this.root, path);
    if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) failMarketData('repository_unsafe');
  }
  path(identity: string): string {
    if (isAbsolute(identity) || identity.includes('\\') || identity.split('/').some(part => part === '' || part === '.' || part === '..')) {
      return failMarketData('repository_unsafe');
    }
    const path = resolve(this.root, ...identity.split('/'));
    this.contained(path);
    return path;
  }

  async directory(path: string, create = false): Promise<boolean> {
    this.contained(path);
    const base = parse(path).root;
    let current = base;
    try {
      for (const part of path.slice(base.length).split(sep).filter(Boolean)) {
        current = resolve(current, part);
        let info;
        try { info = await lstat(current); }
        catch (error) {
          if (nodeErrorCode(error) !== 'ENOENT') throw error;
          if (!create) return false;
          this.contained(current);
          try { await mkdir(current); }
          catch (creation) { if (nodeErrorCode(creation) !== 'EEXIST') throw creation; }
          info = await lstat(current);
        }
        if (info.isSymbolicLink() || !info.isDirectory()) return failMarketData('repository_unsafe');
      }
      return true;
    } catch (error) {
      if (error instanceof MarketDataRepositoryErrorV1) throw error;
      return failMarketData('repository_unavailable');
    }
  }

  async read(path: string, budget?: MarketDataRecoveryBudgetV1,
    maximumBytes = MARKET_DATA_RECOVERY_LIMITS_V1.bytes): Promise<unknown> {
    this.contained(path);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
      || maximumBytes > MARKET_DATA_RECOVERY_LIMITS_V1.bytes) return failMarketData('repository_unsafe');
    if (!await this.directory(dirname(path))) return failMarketData('artifact_not_found');
    try {
      const before = await lstat(path);
      if (before.isSymbolicLink() || !before.isFile()) return failMarketData('repository_unsafe');
      const handle = await open(path, 'r');
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) return failMarketData('repository_unsafe');
        if (info.size > maximumBytes) {
          if (budget) budget.consume(info.size);
          return failMarketData('artifact_corrupt');
        }
        budget?.consume(info.size);
        const bytes = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (read.bytesRead === 0) break;
          offset += read.bytesRead;
          budget?.check();
        }
        if (offset !== info.size || (await handle.stat()).size !== info.size) return failMarketData('artifact_corrupt');
        await this.directory(dirname(path));
        const after = await lstat(path);
        if (after.isSymbolicLink() || after.ino !== info.ino || after.dev !== info.dev) return failMarketData('repository_unsafe');
        budget?.check();
        try { return parseStrictJsonBytesV1(bytes.subarray(0, offset), maximumBytes); }
        catch { return failMarketData('artifact_corrupt'); }
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof MarketDataRepositoryErrorV1) throw error;
      if (nodeErrorCode(error) === 'ENOENT') return failMarketData('artifact_not_found');
      return failMarketData('repository_unavailable');
    }
  }

  async filenames(path: string): Promise<string[]> {
    if (!await this.directory(path)) return [];
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const names: string[] = [];
      for (const entry of entries) {
        if (MARKET_DATA_PRIVATE_TEMP_PATTERN_V1.test(entry.name)) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) return failMarketData('repository_unsafe');
        names.push(entry.name);
      }
      return names;
    } catch (error) {
      if (error instanceof MarketDataRepositoryErrorV1) throw error;
      return failMarketData('repository_unavailable');
    }
  }

  async writeTemporary(path: string, payload: string): Promise<void> {
    this.contained(path);
    await this.directory(dirname(path));
    const handle = await open(path, 'wx');
    try { await handle.writeFile(payload, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
  }

  async cache(path: string, payload: string): Promise<void> {
    await this.directory(dirname(path), true);
    const temporary = resolve(dirname(path), `.${randomUUID()}.tmp`);
    try {
      await this.writeTemporary(temporary, payload);
      try {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isFile()) return failMarketData('repository_unsafe');
      } catch (error) { if (nodeErrorCode(error) !== 'ENOENT') throw error; }
      await this.directory(dirname(path));
      await rename(temporary, path); // Only this disposable cache is replaceable.
    } finally { await rm(temporary, { force: true }); }
  }
}
