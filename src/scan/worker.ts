/**
 * Worker thread entry for the parallel scan.
 *
 * Receives a slice of files, parses them, runs detection, and posts back
 * *aggregated* statistics rather than raw messages — a full scan produces
 * ~100k messages, and shipping those across the thread boundary would cost more
 * than the parse it saves.
 *
 * This module must never invoke the CLI driver. A spike during development had
 * its worker branch re-execute the driver, which spawned workers recursively and
 * drove the machine's load average past 100. The `isMainThread` guard below and
 * the absence of any `runCli` import are both load-bearing.
 */

import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { SycophancyDetector } from '../detector';
import { HarnessId } from '../types';
import { createAdapter } from '../adapters/registry';
import { AggregatedStats, aggregateMessages, createAggregatedStats } from './aggregate';

export interface WorkerTask {
  harness: HarnessId;
  files: string[];
  context?: unknown;
}

export interface WorkerInput {
  tasks: WorkerTask[];
  /** Report progress after this many messages, to keep IPC chatter low. */
  progressEvery: number;
}

export interface WorkerOutput {
  stats: AggregatedStats;
  /** Messages per harness, for the per-harness summary lines. */
  harnessCounts: { harness: HarnessId; messageCount: number; matchCount: number }[];
}

if (!isMainThread) {
  const { tasks, progressEvery } = workerData as WorkerInput;
  const detector = new SycophancyDetector();
  const sessionSeen = new Set<string>();
  const stats = createAggregatedStats();
  const perHarness = new Map<HarnessId, { messageCount: number; matchCount: number }>();

  // Reuse one detector and one adapter instance per harness across files.
  const adapters = new Map<HarnessId, ReturnType<typeof createAdapter>>();
  const adapterFor = (id: HarnessId) => {
    if (!adapters.has(id)) adapters.set(id, createAdapter(id));
    return adapters.get(id);
  };

  let sinceReport = 0;

  const run = async () => {
    for (const task of tasks) {
      const adapter = adapterFor(task.harness);
      const tally = perHarness.get(task.harness) || { messageCount: 0, matchCount: 0 };
      perHarness.set(task.harness, tally);

      // An unparsable file yields nothing; parseFile is per-file independent by
      // contract, so one failure must not abandon the rest of the slice.
      const parse = adapter?.parseFile?.bind(adapter);
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

        sinceReport += messages.length;
        if (sinceReport >= progressEvery) {
          sinceReport = 0;
          parentPort!.postMessage({
            type: 'progress',
            harness: task.harness,
            messageCount: tally.messageCount,
            matchCount: tally.matchCount,
          });
        }
      }
    }

    const output: WorkerOutput = {
      stats,
      harnessCounts: [...perHarness.entries()].map(([harness, v]) => ({
        harness,
        messageCount: v.messageCount,
        matchCount: v.matchCount,
      })),
    };
    parentPort!.postMessage({ type: 'done', output });
  };

  run().catch((err) => {
    parentPort!.postMessage({ type: 'error', message: String(err?.message || err) });
  });
}
