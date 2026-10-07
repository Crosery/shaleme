import { describe, expect, it } from 'bun:test';
import { generateReportHtml } from '../src/report/generator';
import type { DroolLevelInfo, HarnessStats, ReportSummary } from '../src/types';
import { escapeRegex } from '../src/utils/text';

const level: DroolLevelInfo = { level: 0, name: '恪守客观', badge: '🧊 恪守客观', tagline: '稳', color: '#000' };

function summaryWith(phrase: string, snippet: string): ReportSummary {
  const harness: HarnessStats = { harness: 'omp', name: 'OMP', droolCount: 1, messageCount: 10, droolIndex: 1 };
  return {
    version: '0.1.1',
    generatedAt: Date.now(),
    generatedDate: '2026-09-29',
    totalDroolCount: 1,
    totalAssistantMessages: 10,
    totalSessionsScanned: 1,
    activeHarnessCount: 1,
    overallDroolRate: 10,
    overallDroolIndex: 1,
    overallDroolLevel: level,
    modelRankings: [],
    harnessStats: { omp: harness } as ReportSummary['harnessStats'],
    dailyTimeline: [],
    phraseCloud: [{ text: phrase, count: 1, category: 'blind_compliance' }],
    hallOfShame: [{ harness: 'omp', sessionId: 's1', timestamp: Date.now(), model: 'm', phrase, category: 'blind_compliance', snippet }],
  };
}

describe('escapeRegex', () => {
  it('neutralizes every regex metacharacter', () => {
    const raw = '(a+b) [ok] * ? ^ $ \\ | {} .';
    expect(new RegExp(escapeRegex(raw)).test(raw)).toBe(true);
    // The shape that actually aborted the render: a quantifier with nothing to repeat.
    expect(() => new RegExp('**continue**')).toThrow();
    expect(new RegExp(escapeRegex('**continue**')).test('**continue**')).toBe(true);
  });
});

describe('report rendering with a real-world phrase', () => {
  // The phrase that killed the published report: `**` is a quantifier with
  // nothing to repeat, so RegExp construction threw and the render aborted.
  const phrase = '你说一句 **continue** 我就';

  it('renders and highlights it instead of throwing', () => {
    const html = generateReportHtml(summaryWith(phrase, `好的，${phrase}`));
    expect(html).toContain('<span class="quote-target">');
    expect(html).toContain('continue');
  });

  it('renders phrases holding HTML and regex syntax at once', () => {
    const html = generateReportHtml(summaryWith('* <b>x</b> ?', 'see * <b>x</b> ? here'));
    expect(html).toContain('quote-body');
  });
});
