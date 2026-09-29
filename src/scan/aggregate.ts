/**
 * Message-to-statistics aggregation, shared by the serial and parallel scan paths.
 *
 * Both paths MUST funnel through `aggregateMessages`. If the parallel workers
 * computed their own aggregates, the two paths could disagree and the only
 * symptom would be a silently different leaderboard — the differential test in
 * the plan exists exactly to catch that, and it only means something if the
 * aggregation itself is one implementation.
 */

import { SycophancyDetector } from '../detector';
import { DroolMatch, ExtractedMessage, HarnessId, SycophancyCategory } from '../types';
import { formatDate, normalizeModelName } from '../utils/text';

export interface AggregatedStats {
  /** Count of assistant messages seen, per normalized model. */
  modelMessageCounts: Record<string, number>;
  /** Harnesses each normalized model appeared in. */
  modelHarnesses: Record<string, HarnessId[]>;
  /** Every matched phrase occurrence, per normalized model. */
  modelMatches: Record<string, DroolMatch[]>;
  /** Match counts per calendar day (YYYY-MM-DD). */
  dailyCounts: Record<string, number>;
  /** Phrase -> occurrences and its category. */
  phraseCounts: Record<string, { count: number; category: SycophancyCategory }>;
  /** Distinct session ids, for the "sessions scanned" figure. */
  sessionIds: string[];
  messageCount: number;
  matchCount: number;
}

export function createAggregatedStats(): AggregatedStats {
  return {
    modelMessageCounts: {},
    modelHarnesses: {},
    modelMatches: {},
    dailyCounts: {},
    phraseCounts: {},
    sessionIds: [],
    messageCount: 0,
    matchCount: 0,
  };
}

/**
 * Fold a batch of messages into `stats`.
 *
 * `sessionSeen` tracks session ids across batches so the array stays unique;
 * pass the same Set for the whole scan. It is a plain Set rather than part of
 * the stats so the stats stay structured-clone-friendly for worker transfer.
 */
export function aggregateMessages(
  messages: Iterable<ExtractedMessage>,
  stats: AggregatedStats,
  detector: SycophancyDetector,
  sessionSeen: Set<string>,
): void {
  for (const msg of messages) {
    stats.messageCount++;

    if (!sessionSeen.has(msg.sessionId)) {
      sessionSeen.add(msg.sessionId);
      stats.sessionIds.push(msg.sessionId);
    }

    const normModel = normalizeModelName(msg.model);
    stats.modelMessageCounts[normModel] = (stats.modelMessageCounts[normModel] || 0) + 1;

    const harnesses = stats.modelHarnesses[normModel];
    if (!harnesses) {
      stats.modelHarnesses[normModel] = [msg.harness];
    } else if (!harnesses.includes(msg.harness)) {
      harnesses.push(msg.harness);
    }

    const found = detector.scanMessage(msg);
    if (found.length === 0) continue;

    stats.matchCount += found.length;

    const bucket = stats.modelMatches[normModel];
    if (bucket) bucket.push(...found);
    else stats.modelMatches[normModel] = [...found];

    const dayStr = formatDate(msg.timestamp);
    if (dayStr !== 'unknown') {
      stats.dailyCounts[dayStr] = (stats.dailyCounts[dayStr] || 0) + found.length;
    }

    for (const m of found) {
      const existing = stats.phraseCounts[m.phrase];
      if (existing) existing.count++;
      else stats.phraseCounts[m.phrase] = { count: 1, category: m.category };
    }
  }
}

/** Merge a worker's partial stats into the accumulator. */
export function mergeAggregatedStats(target: AggregatedStats, source: AggregatedStats): void {
  target.messageCount += source.messageCount;
  target.matchCount += source.matchCount;

  // Session ids are concatenated here and de-duplicated by `absorbSessionIds`;
  // skipping this would silently undercount "sessions scanned", because the
  // parallel path's sessions would never reach the accumulator.
  if (source.sessionIds.length > 0) target.sessionIds.push(...source.sessionIds);

  for (const [model, count] of Object.entries(source.modelMessageCounts)) {
    target.modelMessageCounts[model] = (target.modelMessageCounts[model] || 0) + count;
  }

  for (const [model, harnesses] of Object.entries(source.modelHarnesses)) {
    const existing = target.modelHarnesses[model];
    if (!existing) {
      target.modelHarnesses[model] = [...harnesses];
      continue;
    }
    for (const h of harnesses) if (!existing.includes(h)) existing.push(h);
  }

  for (const [model, matches] of Object.entries(source.modelMatches)) {
    const existing = target.modelMatches[model];
    if (existing) existing.push(...matches);
    else target.modelMatches[model] = [...matches];
  }

  for (const [date, count] of Object.entries(source.dailyCounts)) {
    target.dailyCounts[date] = (target.dailyCounts[date] || 0) + count;
  }

  for (const [phrase, entry] of Object.entries(source.phraseCounts)) {
    const existing = target.phraseCounts[phrase];
    if (existing) existing.count += entry.count;
    else target.phraseCounts[phrase] = { ...entry };
  }
}

/**
 * De-duplicate `stats.sessionIds` in place, keeping every distinct id.
 *
 * This must NOT drop ids it has seen before. It runs once per merged worker, so
 * an implementation that returns only the newly-unique ids discards everything
 * absorbed by earlier merges — which is exactly how the parallel path silently
 * reported a fraction of the real session count (1943 -> 243 as jobs rose).
 */
export function absorbSessionIds(stats: AggregatedStats, sessionSeen: Set<string>): void {
  const unique: string[] = [];
  const local = new Set<string>();
  for (const id of stats.sessionIds) {
    if (local.has(id)) continue;
    local.add(id);
    unique.push(id);
    sessionSeen.add(id);
  }
  stats.sessionIds = unique;
}
