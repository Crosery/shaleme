/**
 * Can a cheap pre-filter avoid most JSON.parse calls?
 *
 * Parsing dominates scan time (see profile-scan.ts). Most JSONL lines are tool
 * calls, reasoning, and metadata that can never yield an assistant text block.
 * A substring check before JSON.parse is nearly free; if it rejects most lines,
 * it removes most of the parse cost.
 *
 * Usage: bun run spikes/prefilter-parse.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function sampleJsonl(root: string, maxFiles: number): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= maxFiles) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith('.jsonl')) files.push(p);
    }
  };
  walk(root, 0);
  return files;
}

async function main() {
  const home = os.homedir();
  const files = [
    ...sampleJsonl(path.join(home, '.codex/sessions'), 200),
    ...sampleJsonl(path.join(home, '.claude/projects'), 150),
    ...sampleJsonl(path.join(home, '.omp/agent/sessions'), 150),
  ];

  const lines: string[] = [];
  for (const f of files) {
    try {
      const rl = readline.createInterface({ input: fs.createReadStream(f, 'utf8'), crlfDelay: Infinity });
      for await (const l of rl) {
        const t = l.trim();
        if (t) lines.push(t);
      }
    } catch {
      // skip
    }
  }

  console.log(`\n=== prefilter-parse ===\n`);
  console.log(`sampled ${files.length} files, ${lines.length.toLocaleString()} JSONL lines\n`);

  // Baseline: parse everything
  const t1 = process.hrtime.bigint();
  let parsed = 0;
  for (const l of lines) {
    try {
      JSON.parse(l);
      parsed++;
    } catch {
      /* ignore */
    }
  }
  const parseAll = ms(t1);

  // Pre-filter: only lines that look like they could carry assistant text
  const t2 = process.hrtime.bigint();
  let candidate = 0;
  let parsed2 = 0;
  for (const l of lines) {
    const couldBeAssistant =
      l.includes('"assistant"') || l.includes('"role":"model"') || l.includes('"output_text"');
    if (!couldBeAssistant) continue;
    candidate++;
    try {
      JSON.parse(l);
      parsed2++;
    } catch {
      /* ignore */
    }
  }
  const parseFiltered = ms(t2);

  const skipPct = (1 - (candidate / lines.length)) * 100;
  console.log(`parse all lines:      ${parseAll.toFixed(0)} ms  (${parsed.toLocaleString()} parsed)`);
  console.log(`pre-filter + parse:   ${parseFiltered.toFixed(0)} ms  (${candidate.toLocaleString()} parsed)`);
  console.log(`\n  skipped by filter:  ${skipPct.toFixed(1)}% of lines`);
  console.log(`  speedup:            ${(parseAll / parseFiltered).toFixed(2)}x\n`);

  // Correctness guard: does the filter ever drop a line the detector needed?
  let missed = 0;
  for (const l of lines) {
    if (l.includes('"assistant"') || l.includes('"role":"model"') || l.includes('"output_text"')) continue;
    // could a line like this ever be an assistant message?
    if (l.includes('"text"') && !l.includes('"tool"') && !l.includes('"thinking"')) missed++;
  }
  console.log(`  lines without the marker but containing plain "text": ${missed.toLocaleString()}`);
  console.log(`  (review these before adopting the filter)\n`);

  console.log('=== done ===\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
