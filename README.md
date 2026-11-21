# konomi-clean

### ▶ **Live: https://sjgant80-hub.github.io/konomi-clean/**

This repository is a cell of the [estate genome](https://sjgant80-hub.github.io/estate-genome/): its `seed.json` and `genome/` hooks pass the four-trait birth check on every push.

Is your benchmark already in the training data — and what does your headline score become without it?

[![witness](https://github.com/sjgant80-hub/konomi-clean/actions/workflows/witness.yml/badge.svg)](https://github.com/sjgant80-hub/konomi-clean/actions/workflows/witness.yml)

## 1 · The measure matters more than the algorithm

Near-duplicate detection reaches for **Jaccard** similarity, `|A∩B| / |A∪B|`. For contamination that
is **the wrong measure**, and using it is a real and common implementation bug.

An eval item is a few dozen words. A training corpus is billions. If the corpus contains your item
*verbatim*, every shingle of the item is in the corpus — but the union is essentially the corpus, so
Jaccard is ~1e-9 and the item is reported clean. **The measure fails precisely on the case it was
deployed to catch.**

The right measure is **containment**: `|A∩B| / |A|` — what fraction of the *item* appears in the
corpus. A verbatim copy scores 1.0 regardless of corpus size.

Same verbatim copy, corpus grown around it — measured live on the page:

| Corpus | Containment | Jaccard | Verdict each would give |
|---|---|---|---|
| item + 1 sentence | **1.0000** | 0.5217 | contaminated · partial |
| item + 10 sentences | **1.0000** | 0.1667 | contaminated · **clean** |
| item + 100 sentences | **1.0000** | 0.0230 | contaminated · **clean** |
| item + 1000 sentences | **1.0000** | 0.0024 | contaminated · **clean** |

The item is present word-for-word in every row. Containment says so every time. Jaccard forgets — and
gets quieter the larger the corpus is, which is the opposite of what you need, failing silently
rather than erroring.

Jaccard *is* provided, because it is correct for the other question — *are these two items duplicates
of each other* — and the two questions are easy to confuse.

## 2 · Per item, not one rate

"3% of the benchmark is contaminated" cannot be acted on. Every item gets a verdict:

| Verdict | Meaning |
|---|---|
| `EXACT` | The normalised item occurs verbatim in a reference document |
| `NEAR` | Containment ≥ 0.8 |
| `PARTIAL` | Containment ≥ 0.3 — often legitimate, worth reading |
| `CLEAN` | Below the thresholds |

`EXACT` is decided by substring match on normalised text, **not** by the overlap threshold: a short
item can be present word-for-word while its containment sits low, and a verbatim copy is the least
ambiguous finding there is.

## 3 · The impact is the finding

Detection is the easy half. This is the number anyone actually wants:

```
Your benchmark says 5.83. Excluding the 2 leaked items, it says 3.75 — a move of -2.08.
```

A headline that moves when the leaked items are removed was never measuring the model. When grades
come from [konomi-rubric](https://sjgant80-hub.github.io/konomi-rubric/) as seven-place vectors, the
**per-axis** impact comes too — because a leak rarely moves every axis equally, and usually inflates
grounding far more than calibration.

## Also: items that duplicate each other

Near-duplicates *inside* a benchmark over-weight whatever they test and quietly break the
independence assumption every significance test downstream relies on — including the sign test in
[konomi-regress](https://sjgant80-hub.github.io/konomi-regress/). Here Jaccard **is** the right
measure, and it is used.

## Usage

```js
import { makeReference, checkSet, impact, internalDuplicates } from './contaminate.mjs';

const ref = makeReference(corpusDocs, { n: 8 });          // or { estimate: true } for a large corpus
const check = checkSet(evalItems, ref, { n: 8 });

check.results        // per item: verdict, containment, verbatim
impact(check, scores)      // { before, after, delta, droppedIds, perAxis, material }
internalDuplicates(evalItems)
```

For corpora too large to intersect directly, `{ estimate: true }` uses MinHash. Signatures are
**deterministic** — no randomness anywhere, so a signature computed today matches one computed next
year. Note that MinHash estimates *Jaccard*, so `estimateContainment` performs the conversion:

```
|A∩B| = J(|A|+|B|) / (1+J)   ⇒   C(A,B) = |A∩B| / |A|
```

Skipping that conversion is how the measure ends up wrong on exactly the large-corpus case that
motivated the estimate in the first place.

## Verification

```bash
node test.mjs        # 130 assertions
```

| kernel | killed | reviewed-equivalent | verdict |
|---|---|---|---|
| `shingle.mjs` | 14 / 17 | 3 | no test-theatre |
| `contaminate.mjs` | 43 / 45 | 2 | no test-theatre |

The suite proves the measure claim **directly**: the same verbatim copy is scored both ways against a
growing corpus, and Jaccard is shown collapsing while containment holds. A suite that only checked
"the function returns a number" would pass on the buggy version.

## Honest limits

- **You usually cannot see the training data.** This checks against a corpus you hold — your own
  fine-tuning set, your retrieval index, a previous eval set. Absence of a finding here is **not**
  evidence that a model never saw your benchmark.
- Word n-grams at n ≥ 8 essentially do not recur by chance; at small n ordinary English phrasing will
  flag. The n is yours to set and the default is a compromise.
- MinHash mode estimates, and **cannot** report `EXACT` — it has no text to substring-match. The
  result says so rather than guessing.
- **Paraphrased contamination is not caught by any n-gram method.** This finds copies, not ideas.
- The 5% mark for calling an impact "material" is a reporting convenience, not a law. The delta is the
  finding.

## The suite

[konomi-rubric](https://sjgant80-hub.github.io/konomi-rubric/) (grade) ·
[konomi-redteam](https://sjgant80-hub.github.io/konomi-redteam/) (attack) ·
[konomi-regress](https://sjgant80-hub.github.io/konomi-regress/) (compare) ·
**konomi-clean** (is the data honest)

Gated by [witness](https://github.com/sjgant80-hub/witness). MIT.
