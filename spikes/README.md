# Spikes

Throwaway experiments. Not shipped in the npm package (see `files` in package.json).

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

### Conclusion

**Do not replace regex with cosine.** At every operating point cosine is worse
than the regex it would replace:

- Where recall is usable (0.15), precision collapses to 34% -- two thirds of
  hits are false positives.
- Where precision is tolerable (0.35), it misses 76% of the real assent
  ("regex MISSED by cosine: 45" of 59).

The structural reason: a phrase like 你说得对 IS the signal. Exact lexical
form is the definition, so a matcher that tolerates surface variation is
tolerating exactly the distinctions that matter. Cosine also scores 你说得对
and 你说得不对 nearly identically, which is a fatal confusion for this task.

Cosine is only defensible as a **low-precision supplement** for句式泛化
(你说...我就... variants), and even then it contributes mostly noise.
