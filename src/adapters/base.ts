import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { ExtractedMessage, HarnessId } from '../types';

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/**
 * Cross-runtime read-only SQLite query helper (Node.js 22+ node:sqlite & Bun bun:sqlite)
 */
export function querySqlite(dbPath: string, sql: string, params: any[] = []): any[] {
  if (!fs.existsSync(dbPath)) return [];

  // 1. Bun runtime
  if (typeof (globalThis as any).Bun !== 'undefined') {
    try {
      // @ts-ignore
      const { Database } = require('bun:sqlite');
      const db = new Database(dbPath, { readonly: true });
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params);
      db.close();
      return rows || [];
    } catch {
      return [];
    }
  }

  // 2. Node.js built-in node:sqlite
  try {
    // @ts-ignore
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    db.close();
    return rows || [];
  } catch {
    return [];
  }
}

/**
 * Safely find files matching pattern under a root directory with max depth
 */
export function findFilesRecursively(
  rootDir: string,
  filterFn: (filePath: string, filename: string) => boolean,
  maxDepth = 5,
  currentDepth = 0,
): string[] {
  if (currentDepth > maxDepth || !fs.existsSync(rootDir)) {
    return [];
  }

  const results: string[] = [];
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        // Skip common huge irrelevant directories
        if (['node_modules', '.git', 'cache', 'dist', 'build', '.cache'].includes(entry.name)) {
          continue;
        }
        results.push(...findFilesRecursively(fullPath, filterFn, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        if (filterFn(fullPath, entry.name)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore permissions/access errors
  }

  return results;
}

/**
 * Stream lines from a JSONL file without loading entire file into memory
 */
export async function forEachJsonLine(
  filePath: string,
  callback: (data: any, lineNum: number) => void,
): Promise<void> {
  if (!fs.existsSync(filePath)) return;

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      callback(parsed, lineNum);
    } catch {
      // Ignore malformed lines
    }
  }
}

/**
 * A unit of work an adapter can hand to the parallel scan.
 *
 * `files` are parsed by `parseFile`, independently of each other, so they can be
 * spread across worker threads. `context` carries whatever per-adapter state the
 * parse needs (e.g. codex's threadId -> model map) and must survive
 * `structuredClone`, since it crosses a thread boundary.
 */
export interface AdapterWork {
  harness: HarnessId;
  files: string[];
  context?: unknown;
}

export abstract class BaseAdapter {
  abstract readonly id: HarnessId;
  abstract readonly name: string;
  abstract readonly icon: string;
  abstract readonly description: string;

  abstract check(): Promise<boolean>;
  abstract collectMessages(onProgress?: (count: number) => void): AsyncIterable<ExtractedMessage>;

  /**
   * Optional: enumerate files independent of each other.
   *
   * Adapters that implement this (together with `parseFile`) are scanned in
   * parallel. Adapters that do not fall back to the serial `collectMessages`
   * path, so adding the fast path is opt-in and cannot regress the others.
   */
  listWork?(): Promise<AdapterWork>;

  /**
   * Optional: parse one file into messages. Must depend only on the file and
   * `context`, because workers run many of these concurrently and any hidden
   * shared state would corrupt results non-deterministically.
   *
   * Files are not always scannable even when listed (a task can be deleted
   * between enumeration and parse), so returning an empty array is normal.
   */
  parseFile?(file: string, context: any): Promise<ExtractedMessage[]>;
}
