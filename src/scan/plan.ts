/**
 * Turn aggregated statistics into the report structure.
 *
 * Split out of `runUnifiedScan` so the serial path and the parallel path build
 * the report with the same code. A drift here would mean the two paths produce
 * different leaderboards from identical input.
 */

import { getDroolLevel } from '../detector';
import { DailyPoint, DroolMatch, HarnessId, HarnessStats, ModelStats, ReportSummary } from '../types';
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

  // 每个短语至少给一张卡：按短语分组后轮询取样。全局按时间取前 N 条会让
  // 低频短语（57 个里曾有 45 个）一张卡都分不到，点 chip 后空列表。
  // 组内按时间倒序 + 无歧义身份键排序，保证两次运行结果一致。
  const allMatches = Object.values(stats.modelMatches).flat();
  const byPhrase = new Map<string, DroolMatch[]>();
  for (const m of allMatches) {
    const list = byPhrase.get(m.phrase);
    if (list) list.push(m);
    else byPhrase.set(m.phrase, [m]);
  }
  const cmp = (a: DroolMatch, b: DroolMatch) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    if (a.harness !== b.harness) return a.harness.localeCompare(b.harness);
    if (a.sessionId !== b.sessionId) return a.sessionId.localeCompare(b.sessionId);
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.snippet.localeCompare(b.snippet);
  };
  const quoteCap = Math.min(200, Math.max(60, phraseCloud.length));
  const hallOfShame: DroolMatch[] = [];
  const queues = phraseCloud
    .map((p) => byPhrase.get(p.text))
    .filter((q): q is DroolMatch[] => Boolean(q && q.length))
    .map((q) => q.sort(cmp));
  let cursor = 0;
  while (hallOfShame.length < quoteCap) {
    let tookAny = false;
    for (const q of queues) {
      if (cursor < q.length) {
        hallOfShame.push(q[cursor]);
        tookAny = true;
        if (hallOfShame.length >= quoteCap) break;
      }
    }
    if (!tookAny) break;
    cursor += 1;
  }

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
