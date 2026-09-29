/**
 * Where does scan time actually go?
 *
 * Before reaching for a different matching algorithm, measure. This attributes
 * wall-clock to I/O (file reads + JSON parse) vs matching (regex scan), and
 * reports the same numbers when matching is disabled entirely. If matching
 * dominates, a better matcher helps. If I/O dominates, it does not.
 *
 * Usage: bun run spikes/profile-scan.ts [--limit N]
 */

import { SycophancyDetector } from '../src/detector';
import { getAllAdapters } from '../src/adapters';
import type { ExtractedMessage } from '../src/types';

async function collect(limit: number): Promise<ExtractedMessage[]> {
  const adapters = getAllAdapters().filter((a) => ['claude', 'omp', 'pi', 'codex'].includes(a.id));
  const out: ExtractedMessage[] = [];
  for (const adapter of adapters) {
    if (!(await adapter.check())) continue;
    for await (const msg of adapter.collectMessages()) {
      out.push(msg);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function main() {
  const idx = process.argv.indexOf('--limit');
  const limit = idx > -1 ? Number(process.argv[idx + 1]) : 8000;

  console.log(`\n=== profile-scan ===\n`);

  const tCollect = process.hrtime.bigint();
  const messages = await collect(limit);
  const collectMs = ms(tCollect);
  const totalChars = messages.reduce((s, m) => s + m.text.length, 0);

  console.log(`corpus: ${messages.length.toLocaleString()} messages, ${(totalChars / 1e6).toFixed(1)}M chars`);
  console.log(`I/O + parse (adapters):  ${collectMs.toFixed(0)} ms  (${((collectMs / messages.length) * 1000).toFixed(1)} µs/msg)\n`);

  const detector = new SycophancyDetector();

  // Warm up so JIT effects do not land on the first timed pass.
  for (let i = 0; i < Math.min(500, messages.length); i++) detector.scanMessage(messages[i]);

  const tMatch = process.hrtime.bigint();
  let hits = 0;
  for (const m of messages) hits += detector.scanMessage(m).length;
  const matchMs = ms(tMatch);

  console.log(`matching (regex):        ${matchMs.toFixed(0)} ms  (${((matchMs / messages.length) * 1000).toFixed(1)} µs/msg)`);
  console.log(`  hits: ${hits}`);
  console.log(`  throughput: ${(totalChars / 1e6 / (matchMs / 1000)).toFixed(1)}M chars/s\n`);

  const pct = (matchMs / (collectMs + matchMs)) * 100;
  console.log(`share of total time:`);
  console.log(`  I/O + parse: ${(100 - pct).toFixed(1)}%`);
  console.log(`  matching:    ${pct.toFixed(1)}%\n`);

  console.log(
    pct < 20
      ? `=> matching is NOT the bottleneck. A faster matcher cannot help much;\n   the time is in reading and parsing session files.`
      : `=> matching is a meaningful share. Worth optimizing.`,
  );

  // Show the cost breakdown inside matching: how much is the code-fence strip?
  const tStrip = process.hrtime.bigint();
  for (const m of messages) m.text.replace(/```[\s\S]*?```/g, ' ');
  const stripMs = ms(tStrip);
  console.log(`\n  of which code-fence strip: ${stripMs.toFixed(0)} ms (${((stripMs / matchMs) * 100).toFixed(0)}% of matching)`);

  console.log('\n=== done ===\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
