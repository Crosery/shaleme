/**
 * Turn aggregated statistics into the report structure.
 *
 * Split out of `runUnifiedScan` so the serial path and the parallel path build
 * the report with the same code. A drift here would mean the two paths produce
 * different leaderboards from identical input.
 */

import { getDroolLevel } from '../detector';
import { DailyPoint, HarnessId, HarnessStats, ModelStats, ReportSummary } from '../types';
import { AggregatedStats } from './aggregate';

export const HARNESS_NAMES: Record<HarnessId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  omp: 'OMP',
  pi: 'Pi Agent',
  codebuddy: 'CodeBuddy/WorkBuddy',
  cline: 'Cline',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  other: 'Other',
};

export function createEmptyHarnessStats(): Record<HarnessId, HarnessStats> {
  const out = {} as Record<HarnessId, HarnessStats>;
  for (const [harness, name] of Object.entries(HARNESS_NAMES) as [HarnessId, string][]) {
    out[harness] = { harness, name, droolCount: 0, messageCount: 0, droolIndex: 0 };
  }
  return out;
}

export interface PlannerInput {
  stats: AggregatedStats;
  harnessStats: Record<HarnessId, HarnessStats>;
  activeHarnessCount: number;
  version: string;
}

export function buildReportSummary(input: PlannerInput): ReportSummary {
  const { stats, harnessStats, activeHarnessCount, version } = input;

  const modelRankings: ModelStats[] = [];
  for (const [normModel, totalMsgs] of Object.entries(stats.modelMessageCounts)) {
    const droolList = stats.modelMatches[normModel] || [];
    const droolCount = droolList.length;
    const droolRate = totalMsgs > 0 ? Number(((droolCount / totalMsgs) * 100).toFixed(2)) : 0;
    const droolIndex = totalMsgs > 0 ? Number(((droolCount / totalMsgs) * 1000).toFixed(2)) : 0;

    const phraseMap = new Map<string, number>();
    for (const m of droolList) {
      phraseMap.set(m.phrase, (phraseMap.get(m.phrase) || 0) + 1);
    }
    const topPhrases = Array.from(phraseMap.entries())
      .map(([phrase, count]) => ({ phrase, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.phrase.localeCompare(b.phrase);
      })
      .slice(0, 5);

    modelRankings.push({
      model: normModel,
      normalizedModel: normModel,
      droolCount,
      totalMessages: totalMsgs,
      droolRate,
      droolIndex,
      droolLevel: getDroolLevel(droolIndex),
      topPhrases,
      // Sorted because the order harnesses are discovered in depends on which
      // worker reports first, which would make the report non-deterministic.
      harnesses: [...(stats.modelHarnesses[normModel] || [])].sort(),
    });
  }

  // Primary by droolCount DESC, then droolIndex DESC — matches the shipped
  // ordering. The final tie-breaker on the model name matters: without it, two
  // models with equal counts keep insertion order, which differs between the
  // serial and parallel paths and would make the leaderboard reshuffle run to run.
  modelRankings.sort((a, b) => {
    if (b.droolCount !== a.droolCount) return b.droolCount - a.droolCount;
    if (b.droolIndex !== a.droolIndex) return b.droolIndex - a.droolIndex;
    return a.model.localeCompare(b.model);
  });

  const dailyTimeline: DailyPoint[] = Object.entries(stats.dailyCounts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const phraseCloud = Object.entries(stats.phraseCounts)
    .map(([text, v]) => ({ text, count: v.count, category: v.category }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.text.localeCompare(b.text);
    });

  // Recency first, then unambiguous identity keys. A truncated compound key
  // collides when two matches share a timestamp *and* a long common prefix in
  // their snippet, which reorders the list between runs.
  const allMatches = Object.values(stats.modelMatches).flat();
  const hallOfShame = [...allMatches]
    .sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      if (a.harness !== b.harness) return a.harness.localeCompare(b.harness);
      if (a.sessionId !== b.sessionId) return a.sessionId.localeCompare(b.sessionId);
      if (a.model !== b.model) return a.model.localeCompare(b.model);
      if (a.phrase !== b.phrase) return a.phrase.localeCompare(b.phrase);
      return a.snippet.localeCompare(b.snippet);
    })
    .slice(0, 35);

  const totalDroolCount = stats.matchCount;
  const totalAssistantMessages = stats.messageCount;
  const overallDroolRate =
    totalAssistantMessages > 0
      ? Number(((totalDroolCount / totalAssistantMessages) * 100).toFixed(2))
      : 0;
  const overallDroolIndex =
    totalAssistantMessages > 0
      ? Number(((totalDroolCount / totalAssistantMessages) * 1000).toFixed(2))
      : 0;

  return {
    version,
    generatedAt: Date.now(),
    generatedDate: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    totalDroolCount,
    totalAssistantMessages,
    totalSessionsScanned: stats.sessionIds.length,
    activeHarnessCount,
    overallDroolRate,
    overallDroolIndex,
    overallDroolLevel: getDroolLevel(overallDroolIndex),
    modelRankings,
    harnessStats,
    dailyTimeline,
    phraseCloud,
    hallOfShame,
  };
}
