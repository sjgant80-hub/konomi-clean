// contaminate.mjs — which eval items are in the reference corpus, and what that does to the score.
//
// Contamination is normally reported as one number: "3% of the benchmark is contaminated". That
// number is close to useless. It does not say WHICH items, at what overlap, or — the only question
// anyone actually has — what the score would be without them.
//
// So this reports per item, and then reports the thing that matters:
//
//   your benchmark says 74%.
//   excluding the 12 items with ≥0.8 containment, it says 61%.
//
// A headline that moves 13 points when the contaminated items are removed was never a measurement of
// the model. `impact()` is the whole point of this module; the detection is the easy half.
//
// Pure and deterministic: no I/O, no clock, no randomness.
import { shingles, containment, jaccard, normalise, signature, estimateContainment, DEFAULT_N, DEFAULT_K } from './shingle.mjs';

// The number of axes a konomi-rubric grade vector carries. Declared here rather than by vendoring
// the whole fold algebra for one integer — this module needs the width and nothing else.
const PLACES = 7;

// Verdicts, ordered by severity. Deliberately not a score: "0.62 contaminated" invites averaging, and
// the average of a verbatim copy and a clean item is a sentence nobody should write.
export const EXACT = 'EXACT';       // the normalised item occurs verbatim in the reference
export const NEAR = 'NEAR';         // nearly all of the item is present
export const PARTIAL = 'PARTIAL';   // a substantial fragment is present
export const CLEAN = 'CLEAN';
export const VERDICTS = Object.freeze([EXACT, NEAR, PARTIAL, CLEAN]);

export const DEFAULTS = Object.freeze({
  n: DEFAULT_N,          // shingle size in words
  near: 0.8,             // containment at or above this is NEAR
  partial: 0.3,          // containment at or above this is PARTIAL
  k: DEFAULT_K,          // MinHash signature length, when estimating
});

/** Build a reference index from corpus documents. Exact mode holds the shingles; estimate mode does not. */
export function makeReference(docs, { n = DEFAULTS.n, estimate = false, k = DEFAULTS.k } = {}) {
  const texts = docs.map(d => (typeof d === 'string' ? d : String(d && d.text || '')));
  const all = new Set();
  for (const t of texts) for (const sh of shingles(t, n)) all.add(sh);
  const normalisedDocs = estimate ? null : texts.map(normalise);
  return Object.freeze({
    n, estimate, k,
    size: all.size, docs: texts.length,
    shingles: estimate ? null : all,
    signature: estimate ? signature(all, k) : null,
    normalised: normalisedDocs,
  });
}

/**
 * Check one item against the reference.
 * EXACT is decided by substring containment of the NORMALISED text, not by the shingle measure — a
 * short item can be present verbatim while its containment sits below a threshold, and a verbatim
 * copy is the least ambiguous finding there is.
 */
export function checkItem(item, reference, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const text = typeof item === 'string' ? item : String(item && item.text || '');
  const id = typeof item === 'string' ? null : (item && item.id) || null;
  const sh = shingles(text, reference.n);
  const norm = normalise(text);

  let verbatim = false;
  if (!reference.estimate && norm) verbatim = reference.normalised.some(d => d.includes(norm));

  const c = reference.estimate
    ? estimateContainment(signature(sh, reference.k), reference.signature, sh.size, reference.size)
    : containment(sh, reference.shingles);

  const verdict = verbatim ? EXACT : c >= o.near ? NEAR : c >= o.partial ? PARTIAL : CLEAN;
  return {
    id, verdict, containment: c, verbatim,
    shingles: sh.size, estimated: !!reference.estimate,
    contaminated: verdict !== CLEAN,
  };
}

/** Check a whole eval set. */
export function checkSet(items, reference, opts = {}) {
  const results = items.map(it => checkItem(it, reference, opts));
  const counts = {};
  for (const v of VERDICTS) counts[v] = results.filter(r => r.verdict === v).length;
  return {
    spec: 'konomi-clean-v1', reference: { docs: reference.docs, shingles: reference.size, n: reference.n, estimated: !!reference.estimate },
    results, counts,
    contaminated: results.filter(r => r.contaminated).length,
    total: results.length,
    rate: results.length === 0 ? 0 : results.filter(r => r.contaminated).length / results.length,
  };
}

// ── internal duplication ────────────────────────────────────────────────────────────────────
/**
 * Items that duplicate EACH OTHER. A benchmark carrying near-duplicates over-weights whatever they
 * test and quietly breaks the independence assumption every significance test downstream relies on.
 * Here the right measure IS Jaccard — the question is whether two items of comparable size are the
 * same item, not whether one is inside something enormous.
 */
export function internalDuplicates(items, { n = DEFAULTS.n, threshold = 0.8 } = {}) {
  const prepared = items.map((it, k) => ({
    id: (typeof it === 'string' ? null : it && it.id) || `item-${k}`,
    sh: shingles(typeof it === 'string' ? it : String(it && it.text || ''), n),
  }));
  const pairs = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const s = jaccard(prepared[i].sh, prepared[j].sh);
      if (s >= threshold) pairs.push({ a: prepared[i].id, b: prepared[j].id, similarity: s });
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity || x.a.localeCompare(y.a));
}

// ── impact · the part that matters ──────────────────────────────────────────────────────────
/**
 * What the headline becomes once contaminated items are excluded.
 *
 * `scores` maps item id → a number, or → a seven-place vector when the grades came from
 * konomi-rubric (in which case the per-axis impact is reported too, because contamination rarely
 * moves every axis equally — a leaked item usually inflates grounding far more than calibration).
 */
export function impact(check, scores, { drop = [EXACT, NEAR] } = {}) {
  const dropped = new Set(check.results.filter(r => drop.includes(r.verdict)).map(r => r.id));
  const ids = check.results.map(r => r.id).filter(id => id != null && scores[id] !== undefined);
  const kept = ids.filter(id => !dropped.has(id));

  const isVector = ids.length > 0 && Array.isArray(scores[ids[0]]);
  const mean = list => (list.length === 0 ? null : list.reduce((s, id) => s + scores[id], 0) / list.length);

  const out = {
    itemsAll: ids.length, itemsKept: kept.length, itemsDropped: ids.length - kept.length,
    droppedIds: [...dropped].filter(id => scores[id] !== undefined).sort(),
    dropRule: drop.slice(),
  };

  if (isVector) {
    const sum = list => {
      const v = new Array(PLACES).fill(0);
      for (const id of list) for (let i = 0; i < PLACES; i++) v[i] += scores[id][i];
      return v;
    };
    const meanVec = list => (list.length === 0 ? null : sum(list).map(n => n / list.length));
    const a = meanVec(ids), b = meanVec(kept);
    out.before = a === null ? null : a.reduce((s, n) => s + n, 0);
    out.after = b === null ? null : b.reduce((s, n) => s + n, 0);
    out.perAxis = a === null || b === null ? null
      : a.map((n, i) => ({ axis: i, before: n, after: b[i], delta: b[i] - n }));
  } else {
    out.before = mean(ids);
    out.after = mean(kept);
    out.perAxis = null;
  }
  out.delta = (out.before === null || out.after === null) ? null : out.after - out.before;
  // A headline that moves once the leaked items are removed was never measuring the model. The
  // threshold below is a reporting convenience, not a law — the delta is the finding.
  out.material = out.delta !== null && out.before ? Math.abs(out.delta / out.before) >= 0.05 : false;
  return out;
}

export default {
  EXACT, NEAR, PARTIAL, CLEAN, VERDICTS, DEFAULTS,
  makeReference, checkItem, checkSet, internalDuplicates, impact,
};
