/**
 * Adapter construction, isolated from the scan orchestration.
 *
 * `src/scan/*` needs to build adapters (including inside workers) while
 * `src/adapters/index.ts` needs to call the scan — importing one from the other
 * would be a cycle. This module depends on nothing but the adapter classes.
 */

import { HarnessId } from '../types';
import { BaseAdapter } from './base';
import { ClaudeAdapter } from './claude';
import { ClineAdapter } from './cline';
import { CodeBuddyAdapter } from './codebuddy';
import { CodexAdapter } from './codex';
import { CursorAdapter } from './cursor';
import { HermesAdapter } from './hermes';
import { OmpAdapter } from './omp';
import { OpenClawAdapter } from './openclaw';
import { OpenCodeAdapter } from './opencode';
import { PiAdapter } from './pi';

export {
  BaseAdapter,
  ClaudeAdapter,
  ClineAdapter,
  CodeBuddyAdapter,
  CodexAdapter,
  CursorAdapter,
  HermesAdapter,
  OmpAdapter,
  OpenClawAdapter,
  OpenCodeAdapter,
  PiAdapter,
};

export function getAllAdapters(): BaseAdapter[] {
  return [
    new ClaudeAdapter(),
    new CodexAdapter(),
    new OmpAdapter(),
    new PiAdapter(),
    new CodeBuddyAdapter(),
    new ClineAdapter(),
    new HermesAdapter(),
    new OpenClawAdapter(),
    new CursorAdapter(),
    new OpenCodeAdapter(),
  ];
}

/** Build one adapter by harness id. Used by worker threads, which only get ids. */
export function createAdapter(id: HarnessId): BaseAdapter | undefined {
  return getAllAdapters().find((a) => a.id === id);
}
