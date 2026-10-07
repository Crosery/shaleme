import { SycophancyDetector } from '../detector';
import { HarnessId, HarnessInfo, HarnessStats, ReportSummary } from '../types';
import {
  AggregatedStats,
  absorbSessionIds,
  aggregateMessages,
  createAggregatedStats,
  mergeAggregatedStats,
} from '../scan/aggregate';
import { runParallelScan } from '../scan/parallel';
import { buildReportSummary, createEmptyHarnessStats } from '../scan/plan';
import { AdapterWork } from './base';
import { getAllAdapters } from './registry';

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
  createAdapter,
  getAllAdapters,
} from './registry';

export async function detectAvailableAdapters(): Promise<HarnessInfo[]> {
  const adapters = getAllAdapters();
  const results: HarnessInfo[] = [];

  for (const a of adapters) {
    const available = await a.check();
    results.push({
      id: a.id,
      name: a.name,
      icon: a.icon,
      description: a.description,
      available,
    });
  }

  return results;
}

export interface ScanOptions {
  harnesses?: HarnessId[];
  /** Worker threads to use. 1 disables parallelism. Defaults to cores - 1 (capped). */
  jobs?: number;
  onProgress?: (harness: HarnessId, count: number, matchCount: number) => void;
  onHarnessStart?: (harness: HarnessId, name: string) => void;
  onHarnessEnd?: (
    harness: HarnessId,
    name: string,
    messagesCount: number,
    matchesCount: number,
  ) => void;
}

export async function runUnifiedScan(
  options: ScanOptions = {},
  detector = new SycophancyDetector(),
): Promise<ReportSummary> {
  const allAdapters = getAllAdapters();
  const targetAdapters = options.harnesses
    ? allAdapters.filter((a) => options.harnesses!.includes(a.id))
    : allAdapters;

  const harnessStats: Record<HarnessId, HarnessStats> = createEmptyHarnessStats();
  const stats: AggregatedStats = createAggregatedStats();
  const sessionSeen = new Set<string>();

  // Split adapters into those that can be parallelized and those that must run
  // serially. Only adapters implementing listWork + parseFile take the fast path.
  const available: typeof targetAdapters = [];
  for (const adapter of targetAdapters) {
    if (await adapter.check()) available.push(adapter);
  }

  const parallelizable = available.filter(
    (a) => typeof a.listWork === 'function' && typeof a.parseFile === 'function',
  );
  const serialOnly = available.filter(
    (a) => typeof a.listWork !== 'function' || typeof a.parseFile !== 'function',
  );

  let activeHarnessCount = 0;

  // --- Parallel path -------------------------------------------------------
  if (parallelizable.length > 0) {
    for (const a of parallelizable) {
      activeHarnessCount++;
      options.onHarnessStart?.(a.id, a.name);
    }

    const works: AdapterWork[] = [];
    for (const a of parallelizable) {
      works.push(await a.listWork!());
    }

    const result = await runParallelScan(works, detector, {
      jobs: options.jobs,
      onProgress: options.onProgress,
    });

    // Merge first, then de-duplicate exactly once. Calling `absorbSessionIds`
    // before the merge poisons `sessionSeen` with the worker's ids, so the later
    // call treats every one as a duplicate and empties `stats.sessionIds` —
    // silently undercounting "sessions scanned" to just the serial adapters.
    // `mergeAggregatedStats` carries the session ids; do not push them here too.
    mergeAggregatedStats(stats, result.stats);
    absorbSessionIds(stats, sessionSeen);

    // The worker reported per-harness tallies, but a worker slice can hold files
    // from several harnesses; the planner's per-harness stats come from here.
    for (const a of parallelizable) {
      const tally = result.harnessTallies.get(a.id) || { messageCount: 0, matchCount: 0 };
      harnessStats[a.id].messageCount = tally.messageCount;
      harnessStats[a.id].droolCount = tally.matchCount;
      harnessStats[a.id].droolIndex =
        tally.messageCount > 0
          ? Number(((tally.matchCount / tally.messageCount) * 1000).toFixed(2))
          : 0;
      options.onHarnessEnd?.(a.id, a.name, tally.messageCount, tally.matchCount);
    }
  }

  // --- Serial path ---------------------------------------------------------
  for (const adapter of serialOnly) {
    activeHarnessCount++;
    options.onHarnessStart?.(adapter.id, adapter.name);

    const before = { messages: stats.messageCount, matches: stats.matchCount };
    for await (const msg of adapter.collectMessages((cnt) => {
      options.onProgress?.(adapter.id, cnt, stats.matchCount - before.matches);
    })) {
      aggregateMessages([msg], stats, detector, sessionSeen);
    }

    const hMsgCount = stats.messageCount - before.messages;
    const hMatchCount = stats.matchCount - before.matches;
    harnessStats[adapter.id].messageCount = hMsgCount;
    harnessStats[adapter.id].droolCount = hMatchCount;
    harnessStats[adapter.id].droolIndex =
      hMsgCount > 0 ? Number(((hMatchCount / hMsgCount) * 1000).toFixed(2)) : 0;

    options.onHarnessEnd?.(adapter.id, adapter.name, hMsgCount, hMatchCount);
  }

  return buildReportSummary({
    stats,
    harnessStats,
    activeHarnessCount,
    version: '0.1.6',
  });
}
