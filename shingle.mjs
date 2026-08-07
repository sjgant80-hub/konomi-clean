// shingle.mjs — text overlap, measured the way contamination actually needs it.
//
// THE MEASURE MATTERS MORE THAN THE ALGORITHM
//
// Near-duplicate detection almost always reaches for Jaccard similarity, |A∩B| / |A∪B|. For
// contamination that is the wrong measure, and using it is a real and common implementation bug.
//
// An evaluation item is a few dozen words. A training corpus is billions. If the corpus contains your
// item VERBATIM, every shingle of the item is in the corpus — but the union is essentially the corpus,
// so Jaccard is about 1e-9 and the item is reported clean. The measure fails precisely on the case it
// was deployed to catch.
//
// The right measure is CONTAINMENT: |A∩B| / |A| — what fraction of the ITEM appears in the corpus.
// A verbatim copy scores 1.0 no matter how large the corpus is. Jaccard is still provided, because it
// is the correct measure for the other question (are these two ITEMS duplicates of each other), and
// the two questions are easy to confuse.
//
// Shingles are word n-grams, following the standard contamination checks in the literature (8- and
// 13-gram word overlap). Character n-grams are more sensitive but flag ordinary English phrasing as
// contamination; word n-grams at n ≥ 8 essentially do not occur twice by chance.
//
// Pure and deterministic: no I/O, no clock, no randomness.

export const VERSION = '0.1.0';
export const SPEC_VERSION = 'konomi-clean-v1';
export const DEFAULT_N = 8;

/**
 * Normalise before shingling. Case, punctuation and whitespace are not contamination signals, and
 * leaving them in lets a reformatted copy slip through.
 */
export function normalise(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'"\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const words = text => normalise(text).split(' ').filter(Boolean);

/**
 * The set of word n-grams. A text shorter than n yields ONE shingle of the whole text rather than
 * none — otherwise every short item is trivially "clean", which is the wrong answer for a short item
 * that was copied exactly.
 */
export function shingles(text, n = DEFAULT_N) {
  const w = words(text);
  const size = Math.max(1, Math.floor(n));
  if (w.length === 0) return new Set();
  if (w.length <= size) return new Set([w.join(' ')]);
  const out = new Set();
  for (let i = 0; i + size <= w.length; i++) out.add(w.slice(i, i + size).join(' '));
  return out;
}

const inter = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

/** |A∩B| / |A| — the fraction of A found in B. THE contamination measure. */
export function containment(a, b) {
  if (a.size === 0) return 0;
  return inter(a, b) / a.size;
}

/** |A∩B| / |A∪B| — for "are these two items duplicates of each other", NOT for contamination. */
export function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  const i = inter(a, b);
  return i / (a.size + b.size - i);
}

// ── MinHash · for corpora too large to intersect directly ───────────────────────────────────
// Exact intersection needs both shingle sets in memory. When the reference side will not fit, a
// signature of fixed length estimates the overlap instead. The signatures are deterministic — no
// randomness anywhere, so a signature computed today matches one computed next year.

export const DEFAULT_K = 128;

/** FNV-1a, 64-bit, as BigInt. */
export function h64(s) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n, mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) { h = (h ^ BigInt(s.charCodeAt(i))) & mask; h = (h * prime) & mask; }
  return h;
}

const MASK = 0xffffffffffffffffn;
// A fixed, deterministic family of permutations. Derived from the index rather than drawn at random,
// so signatures are reproducible across machines and across time.
const seedA = i => ((h64('a' + i) | 1n) & MASK);
const seedB = i => (h64('b' + i) & MASK);

/** A MinHash signature of a shingle set. Same set → same signature, always. */
export function signature(set, k = DEFAULT_K) {
  const sig = new Array(k).fill(MASK);
  for (const sh of set) {
    const h = h64(sh);
    for (let i = 0; i < k; i++) {
      const v = ((seedA(i) * h + seedB(i)) & MASK);
      if (v < sig[i]) sig[i] = v;
    }
  }
  return sig;
}

/** Estimated Jaccard: the fraction of signature positions that agree. */
export function estimateJaccard(sigA, sigB) {
  if (sigA.length !== sigB.length) throw new Error('signatures must be the same length');
  if (sigA.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) same++;
  return same / sigA.length;
}

/**
 * Estimated containment, derived from the estimated Jaccard and the two set sizes.
 *
 *   J = |A∩B| / |A∪B|   and   |A∪B| = |A| + |B| − |A∩B|
 *   ⇒ |A∩B| = J(|A| + |B|) / (1 + J)
 *   ⇒ C(A,B) = |A∩B| / |A|
 *
 * MinHash estimates Jaccard, not containment, so the conversion is required — and skipping it is how
 * the measure ends up wrong on exactly the large-corpus case that motivated the estimate.
 */
export function estimateContainment(sigA, sigB, sizeA, sizeB) {
  if (sizeA <= 0) return 0;
  const j = estimateJaccard(sigA, sigB);
  if (j === 0) return 0;
  const intersection = (j * (sizeA + sizeB)) / (1 + j);
  return Math.min(1, intersection / sizeA);
}

export default {
  VERSION, SPEC_VERSION, DEFAULT_N, DEFAULT_K,
  normalise, words, shingles, containment, jaccard, h64, signature, estimateJaccard, estimateContainment,
};
