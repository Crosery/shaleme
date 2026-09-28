import { describe, expect, it } from 'bun:test';
import { SycophancyDetector, getDroolLevel } from '../src/detector';
import { ExtractedMessage } from '../src/types';

describe('SycophancyDetector', () => {
  const detector = new SycophancyDetector();

  it('matches exact "你说得对" phrases', () => {
    const msg: ExtractedMessage = {
      harness: 'claude',
      sessionId: 'test-1',
      timestamp: Date.now(),
      model: 'claude-3-7-sonnet',
      text: '你说得对，是我之前疏忽了这个边界条件。我们应该重写该函数。',
    };

    const matches = detector.scanMessage(msg);
    expect(matches.length).toBeGreaterThan(0);
    const phrases = matches.map((m) => m.phrase);
    expect(phrases).toContain('你说得对');
  });

  it('matches multiple sycophantic variations', () => {
    const variations = [
      '你说的对，确实如此',
      '您说得对，我这就去修改',
      '你说得完全正确！',
      '确实是我搞错了，抱歉。',
      "You're right, I missed the semicolon.",
      'Apologies, you are right about the typing.',
    ];

    for (const text of variations) {
      const msg: ExtractedMessage = {
        harness: 'codex',
        sessionId: 'test-v',
        timestamp: Date.now(),
        model: 'gpt-4o',
        text,
      };
      const matches = detector.scanMessage(msg);
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it('generates clean context snippets with ellipsis', () => {
    const msg: ExtractedMessage = {
      harness: 'omp',
      sessionId: 'test-snippet',
      timestamp: Date.now(),
      model: 'deepseek-chat',
      text: '经过重新仔细思考你的指责，你说得对，这里的锁确实会发生死锁。',
    };

    const matches = detector.scanMessage(msg);
    expect(matches.length).toBe(1);
    expect(matches[0].snippet).toContain('你说得对');
  });

  it('does not falsely trigger on normal text without sycophancy', () => {
    const msg: ExtractedMessage = {
      harness: 'claude',
      sessionId: 'test-clean',
      timestamp: Date.now(),
      model: 'claude-opus-5',
      text: '请提供你希望重构的代码文件路径，我将逐步为你分析其依赖关系。',
    };

    const matches = detector.scanMessage(msg);
    expect(matches.length).toBe(0);
  });
});

describe('getDroolLevel', () => {
  it('correctly maps drool indices to stages', () => {
    expect(getDroolLevel(0).level).toBe(0); // 铁骨铮铮
    expect(getDroolLevel(2).level).toBe(0);
    expect(getDroolLevel(5).level).toBe(1); // 偶尔逢迎
    expect(getDroolLevel(20).level).toBe(2); // 顺从阿谀
    expect(getDroolLevel(35).level).toBe(3); // 疯狂点头
    expect(getDroolLevel(80).level).toBe(4); // 口水失禁
  });
});
