import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getConfig } from '../config.js';

/**
 * Small JSON-file store. Deliberately not a database: the operator should be
 * able to open, read and hand-edit every file the agent keeps.
 */
export function dataPath(fileName: string): string {
  return resolve(getConfig().dataDir, fileName);
}

export function readJsonFile<T>(fileName: string, fallback: T): T {
  const path = dataPath(fileName);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (cause) {
    throw new Error(`Corrupt data file ${fileName}; fix or delete it`, { cause });
  }
}

export function writeJsonFile(fileName: string, value: unknown): void {
  const path = dataPath(fileName);
  mkdirSync(dirname(path), { recursive: true });
  // Write to a sibling temp file then rename, so a crash mid-write cannot
  // truncate the run log.
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}
