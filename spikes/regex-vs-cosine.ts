/**
 * Spike: regex vs cosine-similarity matcher comparison.
 *
 * Runs BOTH matchers over real local agent session data and reports the
 * difference: overlap, regex-only hits (cosine misses), cosine-only hits
 * (which are mostly false positives), and per-category breakdown.
 *
 * Zero dependencies: cosine is computed over character 2/3-gram TF-IDF
 * vectors, which is the standard cheap approximation when no embedding
 * service is available. Numbers here bound what a real embedding model
 * would do -- it cannot be dramatically better on SHORT exact phrases.
 *
 * Usage: bun run spikes/regex-vs-cosine.ts [--limit N]
 */

import { SycophancyDetector } from '../src/detector';
import { getAllAdapters } from '../src/adapters';
import type { ExtractedMessage } from '../src/types';

// ---------------------------------------------------------------------------
// Cosine matcher: char n-gram TF-IDF vectors + cosine similarity
// ---------------------------------------------------------------------------

const NGRAM_SIZES = [2, 3];

function ngrams(text: string): string[] {
  // Normalize: strip markdown fences, collapse whitespace, lowercase
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
  const out: string[] = [];
  for (const n of NGRAM_SIZES) {
    for (let i = 0; i + n <= clean.length; i++) {
      out.push(clean.slice(i, i + n));
    }
  }
  return out;
}

function termFreq(text: string): Map<string, number> {
  const tf = new Map<string, number>();
  for (const g of ngrams(text)) {
    tf.set(g, (tf.get(g) || 0) + 1);
  }
  return tf;
}

/** Reference phrases the cosine matcher is asked to recognize. */
const REFERENCE_PHRASES = [
  '你说得对',
  '你说的对',
  '您说得对',
  '你说得很对',
  '你说得完全正确',
  '你说得很有道理',
  '你说得没错',
  '你说得也是',
  '你说得在理',
  '是我疏忽了',
  '是我搞错了',
  '确实是我搞错了',
  '是我考虑不周',
  '抱歉，是我疏忽了',
  '正如你所说',
  '正如你所指出的',
  "you're right",
  'you are right',
  "you're absolutely right",
  'apologies, you are right',
  '你说一声我就',
  '你说删哪些我就删',
  '按你说的改',
  '按你说的做',
  '听你的',
];

class CosineMatcher {
  private df = new Map<string, number>();
  private refVectors: { phrase: string; vec: Map<string, number>; norm: number }[] = [];

  constructor() {
    const refTfs = REFERENCE_PHRASES.map((p) => ({ phrase: p, tf: termFreq(p) }));

    // Document frequency across reference phrases
    for (const { tf } of refTfs) {
      for (const g of tf.keys()) {
        this.df.set(g, (this.df.get(g) || 0) + 1);
      }
    }
    const N = refTfs.length;
    const idf = (g: string) => Math.log((N + 1) / ((this.df.get(g) || 0) + 1)) + 1;

    for (const { phrase, tf } of refTfs) {
      const vec = new Map<string, number>();
      let sumSq = 0;
      for (const [g, f] of tf) {
        const w = (1 + Math.log(f)) * idf(g);
        vec.set(g, w);
        sumSq += w * w;
      }
      this.refVectors.push({ phrase, vec, norm: Math.sqrt(sumSq) || 1 });
    }
  }

  /** Best cosine similarity across all reference phrases, for a window of text. */
  best(text: string): { phrase: string; score: number } {
    const tf = termFreq(text);
    if (tf.size === 0) return { phrase: '', score: 0 };

    const vec = new Map<string, number>();
    const idf = (g: string) => Math.log((this.refVectors.length + 1) / ((this.df.get(g) || 0) + 1)) + 1;
    let sumSq = 0;
    for (const [g, f] of tf) {
      const w = (1 + Math.log(f)) * idf(g);
      vec.set(g, w);
      sumSq += w * w;
    }
    const norm = Math.sqrt(sumSq) || 1;

    let bestPhrase = '';
    let bestScore = 0;
    for (const ref of this.refVectors) {
      let dot = 0;
      for (const [g, w] of vec) {
        const rw = ref.vec.get(g);
        if (rw) dot += w * rw;
      }
      const score = dot / (norm * ref.norm);
      if (score > bestScore) {
        bestScore = score;
        bestPhrase = ref.phrase;
      }
    }
    return { phrase: bestPhrase, score: bestScore };
  }
}

// ---------------------------------------------------------------------------
// Corpus collection (bounded sample for a fast, comparable experiment)
// ---------------------------------------------------------------------------

async function collectSample(limit: number): Promise<ExtractedMessage[]> {
  const adapters = getAllAdapters().filter((a) => ['claude', 'omp', 'pi'].includes(a.id));
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

// ---------------------------------------------------------------------------
// Experiment
// ---------------------------------------------------------------------------

const THRESHOLDS = [0.15, 0.25, 0.35, 0.5, 0.7];

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 12000;

  console.log(`\n=== regex vs cosine :: spike ===`);
  console.log(`collecting up to ${limit.toLocaleString()} assistant messages...\n`);

  const messages = await collectSample(limit);
  console.log(`corpus: ${messages.length.toLocaleString()} assistant messages\n`);

  const detector = new SycophancyDetector();
  const cosine = new CosineMatcher();

  interface Row {
    msg: ExtractedMessage;
    regexPhrases: string[];
    cosinePhrase: string;
    cosineScore: number;
  }

  const rows: Row[] = [];
  for (const msg of messages) {
    const regexHits = detector.scanMessage(msg);

    // Fair application of cosine: split into sentence-ish chunks and score each
    // against the reference phrases. Comparing a whole message to a short phrase
    // is meaningless -- the long vector is dominated by unrelated n-grams.
    const chunks = msg.text
      .replace(/```[\s\S]*?```/g, ' ')
      .split(/[。！？!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 40);

    let bestPhrase = '';
    let bestScore = 0;
    for (const chunk of chunks) {
      const cos = cosine.best(chunk);
      if (cos.score > bestScore) {
        bestScore = cos.score;
        bestPhrase = cos.phrase;
      }
    }

    rows.push({
      msg,
      regexPhrases: regexHits.map((h) => h.phrase),
      cosinePhrase: bestPhrase,
      cosineScore: bestScore,
    });
  }

  const regexMatched = rows.filter((r) => r.regexPhrases.length > 0);

  console.log(`--- regex baseline ---`);
  console.log(`messages with >=1 regex hit: ${regexMatched.length.toLocaleString()}`);
  console.log(
    `total regex hits:            ${rows.reduce((s, r) => s + r.regexPhrases.length, 0).toLocaleString()}\n`,
  );

  console.log(`--- cosine matcher ---`);
  for (const t of THRESHOLDS) {
    const matched = rows.filter((r) => r.cosineScore >= t);
    const agreement = matched.filter((r) => r.regexPhrases.length > 0).length;
    const cosineOnly = matched.filter((r) => r.regexPhrases.length === 0);
    const regexMissedByCosine = regexMatched.filter((r) => r.cosineScore < t);

    console.log(`\nthreshold ${t}`);
    console.log(`  cosine hits:            ${matched.length.toLocaleString()}`);
    console.log(`  agree with regex:       ${agreement.toLocaleString()}`);
    console.log(
      `  regex MISSED by cosine: ${regexMissedByCosine.length.toLocaleString()}` +
        `  <-- false negatives (regex was right, cosine dropped it)`,
    );
    console.log(
      `  cosine-ONLY:            ${cosineOnly.length.toLocaleString()}` +
        `  <-- candidates for false positives`,
    );
  }

  // Inspect the highest-confidence cosine-only hits: are they real assent
  // that regex missed, or noise?
  const best = 0.7;
  const cosineOnly = rows
    .filter((r) => r.cosineScore >= best && r.regexPhrases.length === 0)
    .sort((a, b) => b.cosineScore - a.cosineScore);

  console.log(`\n--- top 12 cosine-only hits at threshold ${best} (manual review) ---`);
  for (const r of cosineOnly.slice(0, 12)) {
    const snippet = r.msg.text.replace(/\s+/g, ' ').slice(0, 110);
    console.log(`\n  score=${r.cosineScore.toFixed(3)} ref="${r.cosinePhrase}"`);
    console.log(`  text: ${snippet}`);
  }

  // False negatives: regex hits that cosine dropped.
  const fn = regexMatched
    .filter((r) => r.cosineScore < best)
    .slice(0, 12);
  console.log(`\n--- 12 regex hits that cosine DROPPED at threshold ${best} ---`);
  for (const r of fn) {
    const snippet = r.msg.text.replace(/\s+/g, ' ').slice(0, 100);
    console.log(`\n  regex=${JSON.stringify(r.regexPhrases)} cosine=${r.cosineScore.toFixed(3)}`);
    console.log(`  text: ${snippet}`);
  }

  console.log('\n=== done ===\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
