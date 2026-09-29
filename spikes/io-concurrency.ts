/**
 * Where does the remaining scan time go, and does concurrency buy it back?
 *
 * spikes/profile-scan.ts established that 94% of scan time is "I/O + parse",
 * not matching. This spike splits that 94% into its two halves and tests the
 * three plausible fixes against each other on the real corpus:
 *
 *   A. readline stream, one file at a time        (what ships today)
 *   B. readFile + split, one file at a time       (is readline the overhead?)
 *   C. readFile + split, N files at a time        (is serialization the cost?)
 *   D. readline stream, N files at a time         (isolate the two variables)
 *
 * Correctness matters more than the numbers here: every variant must report the
 * same message count, or the "speedup" is just dropped work.
 *
 * Usage: bun run spikes/io-concurrency.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { getAllAdapters } from '../src/adapters';
import { findFilesRecursively, getHomeDir } from '../src/adapters/base';

// ---------------------------------------------------------------- corpus

/** The real JSONL session files the adapters would read, collected the same way they do. */
function gatherJsonlFiles(): string[] {
  const home = getHomeDir();
  const files: string[] = [];

  const claudeProjects = path.join(home, '.claude/projects');
  if (fs.existsSync(claudeProjects)) {
    files.push(
      ...findFilesRecursively(claudeProjects, (p, n) => n.endsWith('.jsonl'), 3).filter(
        (p) => !p.includes('shaleme') && !p.includes('-Users-crosery-work-file-tmp'),
      ),
    );
  }

  const codex = path.join(home, '.codex/sessions');
  if (fs.existsSync(codex)) {
    files.push(...findFilesRecursively(codex, (_, n) => n.endsWith('.jsonl'), 6));
  }

  const omp = path.join(home, '.omp/agent/sessions');
  if (fs.existsSync(omp)) {
    files.push(...findFilesRecursively(omp, (_, n) => n.endsWith('.jsonl'), 4));
  }

  const pi = path.join(home, '.pi/agent/sessions');
  if (fs.existsSync(pi)) {
    files.push(...findFilesRecursively(pi, (_, n) => n.endsWith('.jsonl'), 4));
  }

  return files;
}

// ---------------------------------------------------------------- variants

interface ParseStats {
  lines: number;
  parsed: number;
  assistantTexts: number;
}

/** Count assistant text payloads the way adapters do — enough to prove no work was skipped. */
function tallyAssistantText(obj: any, stats: ParseStats): void {
  const msg = obj?.message ?? obj?.payload ?? obj;
  if (msg?.role !== 'assistant' && obj?.role !== 'assistant') return;
  const content = msg?.content ?? obj?.content;
  if (typeof content === 'string') {
    if (content.trim()) stats.assistantTexts++;
  } else if (Array.isArray(content)) {
    for (const b of content) {
      if (typeof b === 'string' && b.trim()) stats.assistantTexts++;
      else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) stats.assistantTexts++;
    }
  }
}

function consumeLine(line: string, stats: ParseStats): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  stats.lines++;
  try {
    tallyAssistantText(JSON.parse(trimmed), stats);
    stats.parsed++;
  } catch {
    /* malformed line, same as shipping code */
  }
}

async function variantA_readlineSerial(files: string[]): Promise<ParseStats> {
  const stats: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
  for (const file of files) {
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) consumeLine(line, stats);
  }
  return stats;
}

async function variantB_readFileSerial(files: string[]): Promise<ParseStats> {
  const stats: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
  for (const file of files) {
    const text = await fs.promises.readFile(file, 'utf8');
    for (const line of text.split('\n')) consumeLine(line, stats);
  }
  return stats;
}

async function variantC_readFileParallel(files: string[], concurrency: number): Promise<ParseStats> {
  const stats: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
  let cursor = 0;
  async function worker(): Promise<void> {
    // Each worker keeps its own counters so the hot loop never touches shared state.
    const local: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
    while (true) {
      const i = cursor++;
      if (i >= files.length) break;
      const text = await fs.promises.readFile(files[i], 'utf8');
      for (const line of text.split('\n')) consumeLine(line, local);
    }
    stats.lines += local.lines;
    stats.parsed += local.parsed;
    stats.assistantTexts += local.assistantTexts;
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return stats;
}

/**
 * E. hybrid: small files buffered (readFile+split), large files streamed
 *    (readline). Bounded memory regardless of the corpus: peak buffered bytes
 *    is at most concurrency * SMALL_LIMIT, since anything bigger streams.
 */
async function variantE_hybrid(
  files: string[],
  concurrency: number,
  smallLimitBytes: number,
): Promise<ParseStats> {
  const stats: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
  let cursor = 0;
  async function worker(): Promise<void> {
    const local: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
    while (true) {
      const i = cursor++;
      if (i >= files.length) break;
      const file = files[i];
      let size = Infinity;
      try {
        size = fs.statSync(file).size;
      } catch {
        continue;
      }
      if (size <= smallLimitBytes) {
        const text = await fs.promises.readFile(file, 'utf8');
        for (const line of text.split('\n')) consumeLine(line, local);
      } else {
        const stream = fs.createReadStream(file, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) consumeLine(line, local);
        rl.close();
      }
    }
    stats.lines += local.lines;
    stats.parsed += local.parsed;
    stats.assistantTexts += local.assistantTexts;
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return stats;
}

/**
 * F. chunked: read each file in fixed-size chunks, carrying the trailing
 *    partial line across chunk boundaries. Gives readFile-class throughput
 *    (plain string split, no stream/readline machinery) with a hard memory
 *    ceiling of concurrency * chunkSize, instead of concurrency * fileSize.
 */
async function variantF_chunked(
  files: string[],
  concurrency: number,
  chunkSize: number,
): Promise<ParseStats> {
  const stats: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
  let cursor = 0;
  async function worker(): Promise<void> {
    const local: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
    const buf = Buffer.allocUnsafe(chunkSize);
    while (true) {
      const i = cursor++;
      if (i >= files.length) break;
      let fd: fs.promises.FileHandle | undefined;
      try {
        fd = await fs.promises.open(files[i], 'r');
        let carry = '';
        while (true) {
          const { bytesRead } = await fd.read(buf, 0, chunkSize, null);
          if (bytesRead === 0) break;
          const data = carry + buf.toString('utf8', 0, bytesRead);
          const lines = data.split('\n');
          carry = lines.pop() as string;
          for (let k = 0; k < lines.length; k++) consumeLine(lines[k], local);
        }
        if (carry) consumeLine(carry, local);
      } catch {
        /* unreadable file: same tolerance as shipping adapters */
      } finally {
        if (fd) await fd.close();
      }
    }
    stats.lines += local.lines;
    stats.parsed += local.parsed;
    stats.assistantTexts += local.assistantTexts;
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return stats;
}

async function variantD_readlineParallel(files: string[], concurrency: number): Promise<ParseStats> {
  const stats: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
  let cursor = 0;
  async function worker(): Promise<void> {
    const local: ParseStats = { lines: 0, parsed: 0, assistantTexts: 0 };
    while (true) {
      const i = cursor++;
      if (i >= files.length) break;
      const stream = fs.createReadStream(files[i], { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) consumeLine(line, local);
      // readline holds no fds after iteration completes, but be explicit.
      rl.close();
    }
    stats.lines += local.lines;
    stats.parsed += local.parsed;
    stats.assistantTexts += local.assistantTexts;
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return stats;
}

// ---------------------------------------------------------------- harness

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function time(label: string, fn: () => Promise<ParseStats>, expect?: ParseStats): Promise<ParseStats> {
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
  }, 20);
  const t = process.hrtime.bigint();
  const stats = await fn();
  const elapsed = ms(t);
  clearInterval(sampler);
  const ok =
    !expect ||
    (expect.lines === stats.lines &&
      expect.parsed === stats.parsed &&
      expect.assistantTexts === stats.assistantTexts);
  const drift = expect ? stats.lines - expect.lines : 0;
  console.log(
    `  ${label.padEnd(28)} ${elapsed.toFixed(0).padStart(6)} ms  ` +
      `peakRSS=${(peakRss / 1e6).toFixed(0).padStart(4)}MB  ` +
      `lines=${stats.lines.toLocaleString().padStart(9)} ` +
      `assistant=${stats.assistantTexts.toLocaleString().padStart(7)}  ` +
      `${ok ? 'ok' : `line-drift ${drift > 0 ? '+' : ''}${drift}`}`,
  );
  return stats;
}

async function main(): Promise<void> {
  const files = gatherJsonlFiles();
  const bytes = files.reduce((s, f) => {
    try {
      return s + fs.statSync(f).size;
    } catch {
      return s;
    }
  }, 0);

  console.log(`\n=== io-concurrency ===\n`);
  console.log(`corpus: ${files.length.toLocaleString()} JSONL files, ${(bytes / 1e6).toFixed(1)} MB\n`);

  if (files.length === 0) {
    console.log('no session files found; nothing to measure');
    return;
  }

  // Warm the page cache so we time parsing, not the first cold read from disk.
  for (const f of files.slice(0, Math.min(200, files.length))) {
    try {
      await fs.promises.readFile(f);
    } catch {
      /* ignore */
    }
  }
  console.log('pass 1 (page cache warm)\n');

  const a = await time('A. readline, serial', () => variantA_readlineSerial(files));
  const b = await time('B. readFile+split, serial', () => variantB_readFileSerial(files));
  const c8 = await time('C. readFile+split, conc=8', () => variantC_readFileParallel(files, 8));
  const c16 = await time('C. readFile+split, conc=16', () => variantC_readFileParallel(files, 16));
  const d16 = await time('D. readline, conc=16', () => variantD_readlineParallel(files, 16));

  const LIMIT = 256 * 1024;
  for (const [label, conc, size] of [
    ['F. chunked(1MB) conc=16', 16, 1 << 20],
    ['F. chunked(4MB) conc=16', 16, 4 << 20],
    ['F. chunked(4MB) conc=24', 24, 4 << 20],
    ['F. chunked(4MB) conc=32', 32, 4 << 20],
    ['F. chunked(16MB) conc=16', 16, 16 << 20],
    ['F. chunked(16MB) conc=32', 32, 16 << 20],
  ] as [string, number, number][]) {
    await time(label, () => variantF_chunked(files, conc, size));
  }
  void LIMIT;

  console.log(`\n=== done ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
