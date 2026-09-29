/**
 * Parallel scan scheduling.
 *
 * The scan is CPU-bound on one thread (UTF-8 decode + JSON.parse over ~1.2M
 * records), which is why worker threads scale here: measured 10.3s -> 1.9s at
 * 14 workers. This module splits each adapter's files across workers and merges
 * their aggregates.
 *
 * Correctness rule: the merge must be order-independent and the planner must be
 * shared with the serial path, or the two paths could report different
 * leaderboards from identical input.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { SycophancyDetector } from '../detector';
import { HarnessId } from '../types';
import { AdapterWork } from '../adapters/base';
import {
  AggregatedStats,
  absorbSessionIds,
  aggregateMessages,
  createAggregatedStats,
  mergeAggregatedStats,
} from './aggregate';
import { WorkerOutput, WorkerTask } from './worker';

export interface HarnessTally {
  messageCount: number;
  matchCount: number;
}

export interface ParallelScanResult {
  stats: AggregatedStats;
  harnessTallies: Map<HarnessId, HarnessTally>;
  /** Harnesses that were scanned but produced no usable worker task. */
  usedParallel: boolean;
}

/**
 * Resolve the worker entry point for both the bundled and source layouts.
 *
 * `dist/cli.js` and `dist/worker.js` are siblings in the published package,
 * while during development the source is `src/scan/parallel.ts` next to
 * `src/scan/worker.ts`. Getting this wrong is exactly the class of bug that
 * broke a previous release, so both layouts are tried and a miss is reported
 * rather than silently falling back.
 */
export function resolveWorkerEntry(): string | null {
  const candidates: string[] = [];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.join(here, 'worker.js'), path.join(here, 'worker.ts'));
  } catch {
    // import.meta.url unavailable (CJS interop): fall through to __dirname.
  }
  if (typeof __dirname === 'string' && path.isAbsolute(__dirname)) {
    candidates.push(
      path.join(__dirname, 'worker.js'),
      path.join(__dirname, 'worker.ts'),
      // Bundled layout: worker.js sits in dist/ beside cli.js.
      path.join(path.dirname(__dirname), 'dist/worker.js'),
    );
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // Ignore unreadable candidates.
    }
  }
  return null;
}

function defaultJobs(): number {
  const cores = os.cpus()?.length || 2;
  // Leave headroom for the parent process and the rest of the user's machine;
  // the scan is memory-hungry enough that claiming every core is counterproductive.
  return Math.max(1, Math.min(8, cores - 1));
}

/**
 * Split tasks into `jobs` slices, balancing by file count.
 *
 * File sizes vary by three orders of magnitude here (a few KB to 350 MB), so
 * round-robin across slices keeps the total bytes per slice roughly even and
 * avoids one worker finishing last on a single huge session.
 */
function sliceTasks(tasks: WorkerTask[], jobs: number): WorkerTask[][] {
  const filesByHarness = new Map<HarnessId, { file: string; context?: unknown }[]>();
  for (const t of tasks) {
    const list = filesByHarness.get(t.harness) || [];
    for (const file of t.files) list.push({ file, context: t.context });
    filesByHarness.set(t.harness, list);
  }

  const slices: WorkerTask[][] = Array.from({ length: jobs }, () => []);
  let next = 0;
  for (const [harness, entries] of filesByHarness) {
    for (const entry of entries) {
      const bucket = slices[next % jobs];
      let task = bucket.find((t) => t.harness === harness);
      if (!task) {
        task = { harness, files: [], context: entry.context };
        bucket.push(task);
      }
      task.files.push(entry.file);
      next++;
    }
  }

  return slices.filter((s) => s.length > 0);
}

export async function runParallelScan(
  works: AdapterWork[],
  detector: SycophancyDetector,
  options: {
    jobs?: number;
    onProgress?: (harness: HarnessId, messageCount: number, matchCount: number) => void;
  } = {},
): Promise<ParallelScanResult> {
  const stats = createAggregatedStats();
  const harnessTallies = new Map<HarnessId, HarnessTally>();
  const sessionSeen = new Set<string>();

  const tasks: WorkerTask[] = works
    .filter((w) => w.files.length > 0)
    .map((w) => ({ harness: w.harness, files: w.files, context: w.context }));

  if (tasks.length === 0) {
    return { stats, harnessTallies, usedParallel: false };
  }

  const entry = resolveWorkerEntry();
  const jobs = Math.max(1, Math.min(options.jobs ?? defaultJobs(), tasks.reduce((n, t) => n + t.files.length, 0)));

  // A single job, or no resolvable worker entry, is better served in-process:
  // spawning a thread to do serial work costs startup and gains nothing.
  if (jobs === 1 || !entry) {
    for (const task of tasks) {
      const adapter = (await import('../adapters/registry')).createAdapter(task.harness);
      const parse = adapter?.parseFile?.bind(adapter);
      const tally = harnessTallies.get(task.harness) || { messageCount: 0, matchCount: 0 };
      harnessTallies.set(task.harness, tally);
      if (!parse) continue;
      for (const file of task.files) {
        let messages;
        try {
          messages = await parse(file, task.context);
        } catch {
          continue;
        }
        if (messages.length === 0) continue;
        const before = stats.matchCount;
        aggregateMessages(messages, stats, detector, sessionSeen);
        tally.messageCount += messages.length;
        tally.matchCount += stats.matchCount - before;
        options.onProgress?.(task.harness, tally.messageCount, tally.matchCount);
      }
    }
    return { stats, harnessTallies, usedParallel: false };
  }

  const slices = sliceTasks(tasks, jobs);
  const results = await Promise.all(
    slices.map(
      (slice, index) =>
        new Promise<{ output: WorkerOutput; index: number }>((resolve, reject) => {
          const worker = new Worker(entry, {
            workerData: { tasks: slice, progressEvery: 2000 },
            // ESM worker entry when the bundle is ESM; harmless for .ts under Bun.
            ...(entry.endsWith('.js') ? {} : {}),
          });

          let settled = false;
          worker.on('message', (msg: any) => {
            if (msg?.type === 'progress') {
              options.onProgress?.(msg.harness, msg.messageCount, msg.matchCount);
              return;
            }
            if (msg?.type === 'error') {
              if (!settled) {
                settled = true;
                reject(new Error(`worker ${index}: ${msg.message}`));
              }
              return;
            }
            if (msg?.type === 'done' && !settled) {
              settled = true;
              resolve({ output: msg.output as WorkerOutput, index });
            }
          });
          worker.on('error', (err) => {
            if (!settled) {
              settled = true;
              reject(err);
            }
          });
          worker.on('exit', (code) => {
            if (!settled) {
              settled = true;
              reject(new Error(`worker ${index} exited with code ${code}`));
            }
          });
        }),
    ),
  );

  for (const { output } of results) {
    mergeAggregatedStats(stats, output.stats);
    absorbSessionIds(stats, sessionSeen);
    for (const h of output.harnessCounts) {
      const existing = harnessTallies.get(h.harness) || { messageCount: 0, matchCount: 0 };
      existing.messageCount += h.messageCount;
      existing.matchCount += h.matchCount;
      harnessTallies.set(h.harness, existing);
    }
  }

  return { stats, harnessTallies, usedParallel: true };
}
