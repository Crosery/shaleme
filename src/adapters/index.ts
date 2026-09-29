import { SycophancyDetector, getDroolLevel } from '../detector';
import {
  DailyPoint,
  DroolMatch,
  HarnessId,
  HarnessInfo,
  HarnessStats,
  ModelStats,
  ReportSummary,
  SycophancyCategory,
} from '../types';
import { formatDate, normalizeModelName } from '../utils/text';
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
  onProgress?: (harness: HarnessId, count: number, matchCount: number) => void;
  onHarnessStart?: (harness: HarnessId, name: string) => void;
  onHarnessEnd?: (harness: HarnessId, name: string, messagesCount: number, matchesCount: number) => void;
}

export async function runUnifiedScan(
  options: ScanOptions = {},
  detector = new SycophancyDetector(),
): Promise<ReportSummary> {
  const allAdapters = getAllAdapters();
  const targetAdapters = options.harnesses
    ? allAdapters.filter((a) => options.harnesses!.includes(a.id))
    : allAdapters;

  const matches: DroolMatch[] = [];
  const modelMessageCounts = new Map<string, number>();
  const modelDroolMatches = new Map<string, DroolMatch[]>();
  const modelHarnesses = new Map<string, Set<HarnessId>>();

  const harnessStatsMap: Record<HarnessId, HarnessStats> = {
    claude: { harness: 'claude', name: 'Claude Code', droolCount: 0, messageCount: 0, droolIndex: 0 },
    codex: { harness: 'codex', name: 'Codex', droolCount: 0, messageCount: 0, droolIndex: 0 },
    omp: { harness: 'omp', name: 'OMP', droolCount: 0, messageCount: 0, droolIndex: 0 },
    pi: { harness: 'pi', name: 'Pi Agent', droolCount: 0, messageCount: 0, droolIndex: 0 },
    codebuddy: { harness: 'codebuddy', name: 'CodeBuddy/WorkBuddy', droolCount: 0, messageCount: 0, droolIndex: 0 },
    cline: { harness: 'cline', name: 'Cline', droolCount: 0, messageCount: 0, droolIndex: 0 },
    openclaw: { harness: 'openclaw', name: 'OpenClaw', droolCount: 0, messageCount: 0, droolIndex: 0 },
    hermes: { harness: 'hermes', name: 'Hermes', droolCount: 0, messageCount: 0, droolIndex: 0 },
    cursor: { harness: 'cursor', name: 'Cursor', droolCount: 0, messageCount: 0, droolIndex: 0 },
    opencode: { harness: 'opencode', name: 'OpenCode', droolCount: 0, messageCount: 0, droolIndex: 0 },
    other: { harness: 'other', name: 'Other', droolCount: 0, messageCount: 0, droolIndex: 0 },
  };

  const dailyCountsMap = new Map<string, number>();
  const phraseCountsMap = new Map<string, { count: number; category: SycophancyCategory }>();
  const sessionIds = new Set<string>();

  let totalAssistantMessages = 0;
  let activeHarnessCount = 0;

  for (const adapter of targetAdapters) {
    const isAvailable = await adapter.check();
    if (!isAvailable) continue;

    activeHarnessCount++;
    if (options.onHarnessStart) {
      options.onHarnessStart(adapter.id, adapter.name);
    }

    let hMsgCount = 0;
    let hMatchCount = 0;

    for await (const msg of adapter.collectMessages((cnt) => {
      if (options.onProgress) {
        options.onProgress(adapter.id, cnt, hMatchCount);
      }
    })) {
      hMsgCount++;
      totalAssistantMessages++;
      sessionIds.add(msg.sessionId);

      if (options.onProgress && (hMsgCount % 15 === 0 || hMsgCount === 1)) {
        options.onProgress(adapter.id, hMsgCount, hMatchCount);
      }

      const normModel = normalizeModelName(msg.model);
      modelMessageCounts.set(normModel, (modelMessageCounts.get(normModel) || 0) + 1);

      if (!modelHarnesses.has(normModel)) {
        modelHarnesses.set(normModel, new Set());
      }
      modelHarnesses.get(normModel)!.add(msg.harness);

      // Detect sycophancy
      const foundMatches = detector.scanMessage(msg);
      if (foundMatches.length > 0) {
        hMatchCount += foundMatches.length;

        if (!modelDroolMatches.has(normModel)) {
          modelDroolMatches.set(normModel, []);
        }
        modelDroolMatches.get(normModel)!.push(...foundMatches);
        matches.push(...foundMatches);

        // Daily timeline
        const dayStr = formatDate(msg.timestamp);
        if (dayStr !== 'unknown') {
          dailyCountsMap.set(dayStr, (dailyCountsMap.get(dayStr) || 0) + foundMatches.length);
        }

        // Phrase counts
        for (const m of foundMatches) {
          const existing = phraseCountsMap.get(m.phrase);
          if (existing) {
            existing.count++;
          } else {
            phraseCountsMap.set(m.phrase, { count: 1, category: m.category });
          }
        }
      }
    }

    harnessStatsMap[adapter.id].messageCount = hMsgCount;
    harnessStatsMap[adapter.id].droolCount = hMatchCount;
    harnessStatsMap[adapter.id].droolIndex =
      hMsgCount > 0 ? Number(((hMatchCount / hMsgCount) * 1000).toFixed(2)) : 0;

    if (options.onHarnessEnd) {
      options.onHarnessEnd(adapter.id, adapter.name, hMsgCount, hMatchCount);
    }
  }

  // Model rankings
  const modelRankings: ModelStats[] = [];
  for (const [normModel, totalMsgs] of modelMessageCounts.entries()) {
    const droolList = modelDroolMatches.get(normModel) || [];
    const droolCount = droolList.length;
    const droolRate = totalMsgs > 0 ? Number(((droolCount / totalMsgs) * 100).toFixed(2)) : 0;
    const droolIndex = totalMsgs > 0 ? Number(((droolCount / totalMsgs) * 1000).toFixed(2)) : 0;
    const levelInfo = getDroolLevel(droolIndex);

    // Phrases for this model
    const phraseMap = new Map<string, number>();
    for (const m of droolList) {
      phraseMap.set(m.phrase, (phraseMap.get(m.phrase) || 0) + 1);
    }
    const topPhrases = Array.from(phraseMap.entries())
      .map(([phrase, count]) => ({ phrase, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    modelRankings.push({
      model: normModel,
      normalizedModel: normModel,
      droolCount,
      totalMessages: totalMsgs,
      droolRate,
      droolIndex,
      droolLevel: levelInfo,
      topPhrases,
      harnesses: Array.from(modelHarnesses.get(normModel) || []),
    });
  }

  // Sort model rankings: primary by droolCount DESC, then droolIndex DESC
  modelRankings.sort((a, b) => {
    if (b.droolCount !== a.droolCount) return b.droolCount - a.droolCount;
    return b.droolIndex - a.droolIndex;
  });

  // Daily timeline sorted by date
  const dailyTimeline: DailyPoint[] = Array.from(dailyCountsMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Phrase cloud sorted by frequency
  const phraseCloud = Array.from(phraseCountsMap.entries())
    .map(([text, v]) => ({ text, count: v.count, category: v.category }))
    .sort((a, b) => b.count - a.count);

  // Hall of shame: top 30 quotes sorted by recency or phrase length
  const hallOfShame = [...matches]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 35);

  const totalDroolCount = matches.length;
  const overallDroolRate =
    totalAssistantMessages > 0
      ? Number(((totalDroolCount / totalAssistantMessages) * 100).toFixed(2))
      : 0;
  const overallDroolIndex =
    totalAssistantMessages > 0
      ? Number(((totalDroolCount / totalAssistantMessages) * 1000).toFixed(2))
      : 0;
  const overallDroolLevel = getDroolLevel(overallDroolIndex);

  return {
    version: '0.1.2',
    generatedAt: Date.now(),
    generatedDate: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    totalDroolCount,
    totalAssistantMessages,
    totalSessionsScanned: sessionIds.size,
    activeHarnessCount,
    overallDroolRate,
    overallDroolIndex,
    overallDroolLevel,
    modelRankings,
    harnessStats: harnessStatsMap,
    dailyTimeline,
    phraseCloud,
    hallOfShame,
  };
}
