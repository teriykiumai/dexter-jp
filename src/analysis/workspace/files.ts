import { constants, existsSync, lstatSync, fstatSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, parse as parsePath, relative, resolve, sep } from 'node:path';
import { RelativePath, fail, parse } from './contracts.js';
import { parseStrictJsonBytesV1 } from '../strategy-validation/strict-json.js';

export function safeDirectory(path: string, create = false): void {
  const absolute = resolve(path), base = parsePath(absolute).root;
  let current = base;
  for (const part of absolute.slice(base.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!existsSync(current) && create) { mkdirSync(current); syncDirectory(dirname(current)); }
    const info = lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('storage_unsafe');
  }
}
export function contained(root: string, path: string): void {
  const child = relative(resolve(root), resolve(path));
  if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) fail('storage_unsafe');
}
export function objectPath(root: string, path: string): string {
  parse(RelativePath, path);
  const result = resolve(root, ...path.split('/')); contained(root, result); return result;
}
export function safeFile(path: string): void {
  safeDirectory(dirname(path));
  if (existsSync(path)) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('storage_unsafe');
  }
}
export function readBytes(path: string, maximumBytes = 256 * 1024 * 1024): Buffer {
  safeFile(path);
  const before = lstatSync(path);
  if (before.size > maximumBytes) fail('backup_invalid');
  const handle = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(handle);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev
      || opened.size !== before.size) fail('storage_unsafe');
    const bytes = readFileSync(handle), after = lstatSync(path);
    if (bytes.length !== before.size || after.ino !== before.ino || after.dev !== before.dev
      || after.size !== before.size || after.nlink !== 1 || after.isSymbolicLink()) fail('storage_unsafe');
    return bytes;
  } finally { closeSync(handle); }
}
export function readJson(path: string): unknown {
  const bytes = readBytes(path); return parseStrictJsonBytesV1(bytes, bytes.length);
}
export function writeExclusive(path: string, bytes: string | Uint8Array): void {
  safeDirectory(dirname(path), true);
  const handle = openSync(path, 'wx', 0o600);
  try { writeFileSync(handle, bytes); fsyncSync(handle); } finally { closeSync(handle); }
  syncDirectory(dirname(path));
}
export function syncFile(path: string): void {
  safeFile(path); const handle = openSync(path, 'r+');
  try { fsyncSync(handle); } finally { closeSync(handle); }
}
export function syncDirectory(path: string): void {
  // Windows does not expose directory fsync through Node. File fsync remains required.
  if (process.platform === 'win32') return;
  const handle = openSync(path, 'r');
  try { fsyncSync(handle); } finally { closeSync(handle); }
}
