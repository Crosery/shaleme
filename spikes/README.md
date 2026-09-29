# Spikes

Throwaway experiments. Excluded from the npm package via `files` in package.json.

## regex-vs-cosine.ts

Answers: **should the phrase matcher be replaced by cosine similarity?**

Run: `bun run spikes/regex-vs-cosine.ts --limit 8000`

### Result (8,000 real assistant messages, char bigram+trigram TF-IDF cosine)

Regex baseline: 59 messages hit, 60 total hits.

| threshold | cosine hits | agree w/ regex | precision | recall |
|---|---|---|---|---|
| 0.15 | 114 | 39 | 34% | 66% |
| 0.25 | 50 | 26 | 52% | 44% |
| 0.35 | 20 | 14 | 70% | 24% |
| 0.50 | 6 | 5 | 83% | 8% |
| 0.70 | 1 | 1 | 100% | 2% |

### Conclusion: do NOT replace regex with cosine

At every operating point cosine is worse than the regex it would replace.
Where recall is usable (0.15) precision collapses to 34%; where precision is
tolerable (0.35) it misses 76% of real assent.

Structural reason: a phrase like 你说得对 **is** the signal. Exact lexical form
is the definition, so a matcher tolerant of surface variation tolerates away the
only distinction that matters. Cosine also scores 你说得对 and 你说得不对 nearly
identically, which is fatal here.

## profile-scan.ts

Answers: **is matching the scan bottleneck, and would a faster matcher help?**

Run: `bun run spikes/profile-scan.ts --limit 12000`

### Result

```
corpus: 12,000 messages, 3.9M chars
I/O + parse (adapters):  4141 ms  (345.0 µs/msg)
matching (regex):         252 ms  ( 21.0 µs/msg)   15.3M chars/s
share: I/O 94.3% / matching 5.7%
```

### Conclusion: matching is NOT the bottleneck

Regex matching runs at 15.3M chars/s and is **5.7%** of scan time. Replacing it
with embeddings would make a large fraction of the runtime *worse*, because
embedding inference is orders of magnitude slower than 21 µs/message.

The time is in **reading and parsing JSONL** (94%). Any real speedup must come
from I/O or parsing, not from the matcher.

Full CLI run for reference: **~19 s** for ~100k messages across 8 harnesses.

## prefilter-parse.ts

Answers: **can a substring gate before JSON.parse cut the parse cost?**

Run: `bun run spikes/prefilter-parse.ts`

### Result (277,848 real JSONL lines)

```
parse all lines:      2014 ms  (277,848 parsed)
pre-filter + parse:    579 ms  ( 82,586 parsed)
  skipped by filter:  70.3% of lines
  speedup:            3.48x        <-- in isolation
```

### Conclusion: it does not help end to end — reverted

The gate was implemented across all six JSONL adapters and measured on the real
CLI. It made the full scan **slower**, consistently:

| run | without gate | with gate |
|---|---|---|
| median of 3–5 runs | **18.9 s** | **23.0 s** |

Why the isolated 3.48× did not transfer: the micro-benchmark parses synthetic
uniform lines in a tight loop, while the real scan streams from disk and is
bound by I/O scheduling and allocation. Adding a per-line `includes()` pass
across three markers costs more than the `JSON.parse` it avoids, because V8
parses these small flat objects very quickly and the gate runs on **every** line.

Reverted. Kept here so the next person does not re-attempt it on the same theory.
The honest lever for real speedup is I/O concurrency (reading session files in
parallel), not cheaper matching or cheaper parsing.

## io-concurrency.ts

Answers: **where does the 94% "I/O + parse" go, and does concurrency buy it back?**

Run: `bun run spikes/io-concurrency.ts`

### Result (2,256 files, 8 GB real corpus; one variant per process for RSS)

| variant | time | peak RSS |
|---|---|---|
| A. readline stream, serial (ships today) | 13.5 s | 878 MB |
| B. readFile + split, serial | 10.9 s | **5,350 MB** |
| C. readFile + split, conc=8 | **6.6 s** | **6,483 MB** |
| D. readline stream, conc=16 | 11.4 s | 5,296 MB |
| E. hybrid small/large, conc=16 | 11.4 s | 1,693 MB |
| F. chunked, conc=32 | 8.2 s | 1,679 MB |

Note C/D "conc=16" numbers are cross-contaminated: Bun does not return freed
memory to the OS, so RSS accumulates across variants in one process. Trust the
one-variant-per-process runs (A, B, C8) for memory.

### Conclusions

- **`readline` is the bottleneck, not `readFile`**: B beats A by 24% at equal
  concurrency. `readline`'s per-line event plumbing dominates on large logs.
- **`readFile` is disqualified by memory**: 24 session files exceed 50 MB and
  two exceed 200 MB (largest 350 MB). Buffering them whole peaks at 5-6 GB.
- **Concurrency alone does not fix readline** (D ≈ A): on Bun, async iteration
  over `readline` does not overlap usefully.
- Chunked reading gets readFile-class throughput inside a fixed memory ceiling,
  which is the only combination that satisfies both constraints.

### But it is not worth shipping on its own

The chunked reader was then implemented for real (`forEachJsonLine`, splitting
on **bytes** so UTF-8 sequences straddling a chunk boundary are never decoded
mid-character) and differentially verified byte-identical against the old
reader over 460 files / 401,097 records including all 8 largest.

Interleaved A/B on the real CLI (4 rounds, alternating builds to cancel machine
drift) — OLD median 20.72 s vs NEW median 20.11 s: **~3%**, not the 1.6× the
micro-benchmark implied. Under Node it also *raised* resident memory
(0.66 GB → 1.3 GB), because splitting a whole 1 MB chunk creates thousands of
live substrings at once where `readline` held one line at a time.

~3% does not justify 100 lines of UTF-8 chunk-boundary subtlety in the hot path
of every adapter, so it was reverted. The micro-benchmark measured the wrong
thing: it timed tight loops over already-hot pages, not the real scan.

## worker-scaling.ts

Answers: **is the scan CPU-bound, and does worker_threads parallelism scale?**

Run: `bun run spikes/worker-scaling.ts`

### Result (same 8 GB corpus, 14 cores)

```
serial            10304 ms
workers=2          5905 ms   1.75x
workers=4          3409 ms   3.02x
workers=6          2497 ms   4.13x
workers=8          2195 ms   4.69x
workers=14         1875 ms   5.50x
```

(`MISMATCH` on line counts is live sessions being appended to during the run:
the drift is a few lines out of 1,205,521, and `assistant` counts are equal.)

### Conclusion: this is the lever

Node reports `user ≈ real` for the scan, and the reader swap above proves the
work is not I/O-scheduler-bound, so the scan is **CPU-bound on one thread** —
UTF-8 decode plus `JSON.parse` over 1.2 M JSONL records. Parallelism scales
near-linearly to 5.5× and is the only change that materially answers "it's slow".

Caveat to carry into the real implementation: the spike parses only. The real
scan also runs detection and holds per-model aggregation state, and peak memory
becomes `workers × per-worker working set`, so the worker count needs a cap.

