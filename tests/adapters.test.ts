import { describe, expect, it } from 'bun:test';
import { normalizeModelName } from '../src/utils/text';
import { getAllAdapters } from '../src/adapters';

describe('normalizeModelName', () => {
  it('strips vendor prefixes', () => {
    expect(normalizeModelName('anthropic/claude-3.5-sonnet')).toBe('claude-3-5-sonnet');
    expect(normalizeModelName('openai/gpt-4o')).toBe('gpt-4o');
    expect(normalizeModelName('crosery/gpt-5.6-luna')).toBe('gpt-5.6-luna');
  });

  it('strips date suffixes', () => {
    expect(normalizeModelName('claude-3-7-sonnet-20250219')).toBe('claude-3-7-sonnet');
    expect(normalizeModelName('gpt-4o-2024-08-06')).toBe('gpt-4o');
  });
});

describe('getAllAdapters', () => {
  it('provides all 10 mainstream adapters', () => {
    const adapters = getAllAdapters();
    expect(adapters.length).toBe(10);
    const ids = adapters.map((a) => a.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('codex');
    expect(ids).toContain('omp');
    expect(ids).toContain('pi');
    expect(ids).toContain('codebuddy');
    expect(ids).toContain('cline');
    expect(ids).toContain('openclaw');
    expect(ids).toContain('hermes');
    expect(ids).toContain('cursor');
    expect(ids).toContain('opencode');
  });
});
