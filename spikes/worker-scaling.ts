/**
 * Is the scan CPU-bound, and does worker_threads parallelism scale?
 *
 * spikes/profile-scan.ts showed 94% of scan time is "I/O + parse", and the CLI
 * A/B showed the reader swap only buys ~3%. The remaining explanation is that
 * this work is CPU-bound on one thread (Node reports user≈real), in which case
 * the only large win is spreading JSON.parse + matching across cores.
 *
 * This spike measures the *upside* before anyone commits to the refactor:
 * parse the same corpus serially, then across N worker threads, and compare.
 * If it does not scale, a workers refactor is not worth its complexity.
 *
 * Usage: bun run spikes/worker-scaling.ts [--workers 4] [--limit-bytes N]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { findFilesRecursively, getHomeDir } from '../src/adapters/base';

interface Counts {
  lines: number;
  parsed: number;
  assistantTexts: number;
  chars: number;
}

function emptyCounts(): Counts {
  return { lines: 0, parsed: 0, assistantTexts: 0, chars: 0 };
}

/** Read + parse + tally, the same work the adapters do before detection. */
function processFiles(files: string[]): Counts {
  const c = emptyCounts();
  const CHUNK = 1 << 20;
  const buf = Buffer.allocUnsafe(CHUNK);
  for (const file of files) {
    let fd: number;
    try {
      fd = fs.openSync(file, 'r');
    } catch {
      continue;
    }
    let carry = '';
    try {
      for (;;) {
        const bytesRead = fs.readSync(fd, buf, 0, CHUNK, null);
        if (bytesRead === 0) break;
        const data = carry + buf.toString('utf8', 0, bytesRead);
        const lines = data.split('\n');
        carry = lines.pop() as string;
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          if (!t) continue;
          c.lines++;
          c.chars += t.length;
          try {
            const obj = JSON.parse(t);
            c.parsed++;
            const msg = obj?.message ?? obj?.payload ?? obj;
            if (msg?.role === 'assistant' || obj?.role === 'assistant') c.assistantTexts++;
          } catch {
            /* malformed */
          }
        }
      }
      if (carry) {
        c.lines++;
        c.chars += carry.length;
        try {
          JSON.parse(carry);
          c.parsed++;
        } catch {
          /* malformed */
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return c;
}

// ---------------------------------------------------------------- worker mode

if (!isMainThread) {
  const { files } = workerData as { files: string[] };
  parentPort!.postMessage(processFiles(files));
}

// ---------------------------------------------------------------- corpus

function gatherFiles(): string[] {
  const home = getHomeDir();
  const files: string[] = [];
  const add = (d: string, depth: number, f: (p: string, n: string) => boolean) => {
    if (fs.existsSync(d)) files.push(...findFilesRecursively(d, f, depth));
  };
  add(
    path.join(home, '.claude/projects'),
    3,
    (p, n) => n.endsWith('.jsonl') && !p.includes('shaleme') && !p.includes('-Users-crosery-work-file-tmp'),
  );
  add(path.join(home, '.codex/sessions'), 6, (_, n) => n.endsWith('.jsonl'));
  add(path.join(home, '.omp/agent/sessions'), 4, (_, n) => n.endsWith('.jsonl'));
  add(path.join(home, '.pi/agent/sessions'), 4, (_, n) => n.endsWith('.jsonl'));
  return files;
}

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function runWorkers(files: string[], n: number): Promise<Counts> {
  // Contiguous slices: keeps each worker's reads local, avoids interleaving.
  const per = Math.ceil(files.length / n);
  const slices: string[][] = [];
  for (let i = 0; i < files.length; i += per) slices.push(files.slice(i, i + per));

  const results = await Promise.all(
    slices.map(
      (slice) =>
        new Promise<Counts>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), { workerData: { files: slice } });
          w.once('message', (m: Counts) => resolve(m));
          w.once('error', reject);
          w.once('exit', (code) => {
            if (code !== 0) reject(new Error(`worker exited ${code}`));
          });
        }),
    ),
  );

  return results.reduce((acc, r) => {
    acc.lines += r.lines;
    acc.parsed += r.parsed;
    acc.assistantTexts += r.assistantTexts;
    acc.chars += r.chars;
    return acc;
  }, emptyCounts());
}

async function main(): Promise<void> {
  const argOf = (flag: string, dflt: number): number => {
    const i = process.argv.indexOf(flag);
    return i > -1 ? Number(process.argv[i + 1]) : dflt;
  };
  const maxWorkers = argOf('--workers', os.cpus().length);

  const files = gatherFiles();
  const bytes = files.reduce((s, f) => {
    try {
      return s + fs.statSync(f).size;
    } catch {
      return s;
    }
  }, 0);

  console.log(`\n=== worker-scaling ===\n`);
  console.log(`cores: ${os.cpus().length}`);
  console.log(`corpus: ${files.length.toLocaleString()} files, ${(bytes / 1e6).toFixed(0)} MB\n`);

  // Warm page cache so we time CPU, not first cold read.
  for (const f of files.slice(0, 400)) {
    try {
      fs.readFileSync(f);
    } catch {
      /* ignore */
    }
  }

  const tSerial = process.hrtime.bigint();
  const serial = processFiles(files);
  const serialMs = ms(tSerial);
  console.log(
    `  serial          ${serialMs.toFixed(0).padStart(6)} ms   lines=${serial.lines.toLocaleString()}  assistant=${serial.assistantTexts.toLocaleString()}`,
  );

  let prev = serialMs;
  for (const n of [2, 4, 6, 8, maxWorkers]) {
    if (n > maxWorkers) continue;
    const t = process.hrtime.bigint();
    const r = await runWorkers(files, n);
    const elapsed = ms(t);
    const ok = r.lines === serial.lines && r.parsed === serial.parsed;
    console.log(
      `  workers=${String(n).padEnd(2)}     ${elapsed.toFixed(0).padStart(6)} ms   ` +
        `speedup=${(serialMs / elapsed).toFixed(2)}x  ${ok ? 'ok' : 'MISMATCH'}`,
    );
    prev = elapsed;
  }
  void prev;

  console.log(`\n=== done ===\n`);
}

// Workers import this module too, so the driver must only run on the main thread.
if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
