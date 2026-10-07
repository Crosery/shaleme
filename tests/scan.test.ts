import { describe, expect, it } from 'bun:test';
import { SycophancyDetector } from '../src/detector';
import {
  AggregatedStats,
  absorbSessionIds,
  aggregateMessages,
  createAggregatedStats,
  mergeAggregatedStats,
} from '../src/scan/aggregate';
import { buildReportSummary, createEmptyHarnessStats } from '../src/scan/plan';
import { ExtractedMessage } from '../src/types';
import { buildLeaderboardPayload } from '../src/share/payload';

function msg(over: Partial<ExtractedMessage> = {}): ExtractedMessage {
  return {
    harness: 'claude',
    sessionId: 's1',
    timestamp: Date.UTC(2026, 0, 2),
    model: 'claude-opus-5',
    text: '你说得对，我改。',
    ...over,
  };
}

function run(messages: ExtractedMessage[]): AggregatedStats {
  const stats = createAggregatedStats();
  aggregateMessages(messages, stats, new SycophancyDetector(), new Set());
  return stats;
}

describe('aggregateMessages', () => {
  it('counts messages and matches per model', () => {
    const stats = run([msg(), msg(), msg({ text: '好的，开始实现。' })]);
    expect(stats.messageCount).toBe(3);
    expect(stats.matchCount).toBe(2);
    expect(stats.modelMessageCounts['claude-opus-5']).toBe(3);
    expect(stats.modelMatches['claude-opus-5'].length).toBe(2);
  });

  it('normalizes model names before bucketing', () => {
    const stats = run([msg({ model: 'anthropic/claude-opus-5' }), msg({ model: 'claude-opus-5' })]);
    expect(Object.keys(stats.modelMessageCounts)).toEqual(['claude-opus-5']);
    expect(stats.modelMessageCounts['claude-opus-5']).toBe(2);
  });

  it('records each session id once', () => {
    const stats = run([msg(), msg(), msg({ sessionId: 's2' })]);
    expect(stats.sessionIds.sort()).toEqual(['s1', 's2']);
  });

  it('tracks distinct harnesses per model', () => {
    const stats = run([msg({ harness: 'claude' }), msg({ harness: 'omp' }), msg({ harness: 'omp' })]);
    expect(stats.modelHarnesses['claude-opus-5'].sort()).toEqual(['claude', 'omp']);
  });
});

describe('absorbSessionIds', () => {
  // Regression: this previously returned only newly-unique ids, so each merged
  // worker discarded the ids absorbed by earlier merges. The session count
  // silently fell from 1943 to 243 as job count rose, with no visible error.
  it('keeps ids absorbed by earlier merges', () => {
    const target = createAggregatedStats();
    const seen = new Set<string>();

    target.sessionIds.push('a', 'b');
    absorbSessionIds(target, seen);
    expect(target.sessionIds.sort()).toEqual(['a', 'b']);

    target.sessionIds.push('c');
    absorbSessionIds(target, seen);
    expect(target.sessionIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('removes duplicates without dropping distinct ids', () => {
    const stats = createAggregatedStats();
    stats.sessionIds.push('a', 'a', 'b', 'a', 'c');
    absorbSessionIds(stats, new Set());
    expect(stats.sessionIds.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('mergeAggregatedStats', () => {
  it('carries session ids from the source', () => {
    // Regression: the parallel path relied on this and the ids were dropped.
    const target = createAggregatedStats();
    const source = run([msg({ sessionId: 'worker-session' })]);
    mergeAggregatedStats(target, source);
    expect(target.sessionIds).toContain('worker-session');
  });

  it('is additive and idempotent in shape', () => {
    const target = run([msg()]);
    const source = run([msg({ sessionId: 's2' }), msg({ sessionId: 's3', text: '真的吗？' })]);
    mergeAggregatedStats(target, source);
    expect(target.messageCount).toBe(3);
    expect(target.matchCount).toBe(2);
    expect(target.modelMessageCounts['claude-opus-5']).toBe(3);
  });

  it('unions phrase counts across sources', () => {
    const target = run([msg({ text: '你说得对' })]);
    const source = run([msg({ sessionId: 's2', text: '你说得对' })]);
    mergeAggregatedStats(target, source);
    expect(target.phraseCounts['你说得对'].count).toBe(2);
  });
});

describe('buildReportSummary determinism', () => {
  it('orders models stably when counts tie', () => {
    const a = run([msg({ model: 'aaa-model' }), msg({ model: 'bbb-model' })]);
    const b = run([msg({ model: 'bbb-model' }), msg({ model: 'aaa-model' })]);
    const reportA = buildReportSummary({
      stats: a,
      harnessStats: createEmptyHarnessStats(),
      activeHarnessCount: 1,
      version: 'test',
    });
    const reportB = buildReportSummary({
      stats: b,
      harnessStats: createEmptyHarnessStats(),
      activeHarnessCount: 1,
      version: 'test',
    });
    // Identical inputs in a different insertion order must produce the same report.
    expect(reportA.modelRankings.map((m) => m.model)).toEqual(
      reportB.modelRankings.map((m) => m.model),
    );
    expect(reportA.modelRankings.map((m) => m.model)).toEqual(['aaa-model', 'bbb-model']);
  });

  it('sorts harnesses per model so worker order cannot leak into output', () => {
    const stats = run([msg({ harness: 'pi' }), msg({ harness: 'claude' }), msg({ harness: 'omp' })]);
    const report = buildReportSummary({
      stats,
      harnessStats: createEmptyHarnessStats(),
      activeHarnessCount: 1,
      version: 'test',
    });
    expect(report.modelRankings[0].harnesses).toEqual(['claude', 'omp', 'pi']);
  });

  it('computes MDI as matches per thousand messages', () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      msg({ sessionId: `s${i}`, text: i < 5 ? '你说得对' : '好的。' }),
    );
    const report = buildReportSummary({
      stats: run(messages),
      harnessStats: createEmptyHarnessStats(),
      activeHarnessCount: 1,
      version: 'test',
    });
    expect(report.totalAssistantMessages).toBe(100);
    expect(report.totalDroolCount).toBe(5);
    expect(report.overallDroolIndex).toBe(50);
  });
});

describe('buildLeaderboardPayload', () => {
  it('carries counts and model names but no message text', () => {
    const messages = [
      msg({ sessionId: 's1', text: '你说得对，我改。这是很长的对话正文不该外传。' }),
      msg({ sessionId: 's2', text: '好的。', model: 'gpt-6-astra' }),
    ];
    const report = buildReportSummary({
      stats: run(messages),
      harnessStats: createEmptyHarnessStats(),
      activeHarnessCount: 1,
      version: '0.1.2',
    });
    const payload = buildLeaderboardPayload(report);

    expect(payload.droolCount).toBe(1);
    expect(payload.assistantMessages).toBe(2);
    expect(payload.modelCount).toBe(2);
    expect(payload.modelEntries.map((m) => m.model).sort()).toEqual([
      'claude-opus-5',
      'gpt-6-astra',
    ]);

    // The submission must not leak conversation content. The report's own
    // hallOfShame holds snippets, so assert the payload never serialises one.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('不该外传');
    expect(serialized).not.toContain('snippet');
    expect(serialized).not.toContain('sessionId');
    expect(serialized).not.toContain('hallOfShame');
  });

  it('reports MDI consistent with the summary', () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      msg({ sessionId: `s${i}`, text: i < 2 ? '你说得对' : '好的。' }),
    );
    const report = buildReportSummary({
      stats: run(messages),
      harnessStats: createEmptyHarnessStats(),
      activeHarnessCount: 1,
      version: '0.1.2',
    });
    const payload = buildLeaderboardPayload(report);
    expect(payload.mdi).toBe(report.overallDroolIndex);
    expect(payload.mdi).toBe(40);
  });

  it('carries per-harness counts for the harness leaderboard', () => {
    const messages = [
      msg({ sessionId: 's1', text: '你说得对，我改。' }),
      msg({ sessionId: 's1', text: '好的。' }),
      msg({ sessionId: 's2', harness: 'codex', text: '按你说的改。', model: 'gpt-6-astra' }),
      msg({ sessionId: 's2', harness: 'codex', text: '收到。', model: 'gpt-6-astra' }),
    ];
    const harnessStats = createEmptyHarnessStats();
    for (const m of messages) {
      const h = harnessStats[m.harness];
      h.messageCount += 1;
      if (new SycophancyDetector().scanMessage(m).length > 0) h.droolCount += 1;
    }
    const report = buildReportSummary({
      stats: run(messages),
      harnessStats,
      activeHarnessCount: 2,
      version: '0.1.6',
    });
    const payload = buildLeaderboardPayload(report);
    const rows = Object.fromEntries(payload.harnessEntries.map((h) => [h.harness, h]));
    expect(rows['Claude Code'].totalMessages).toBe(2);
    expect(rows['Claude Code'].droolCount).toBe(1);
    expect(rows['Codex'].totalMessages).toBe(2);
    expect(rows['Codex'].droolCount).toBe(1);
    // 零消息的 harness 不进载荷；载荷里也不许出现对话正文。
    expect(payload.harnessEntries.every((h) => h.totalMessages > 0)).toBe(true);
    expect(JSON.stringify(payload.harnessEntries)).not.toContain('我改');
  });
});
