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
