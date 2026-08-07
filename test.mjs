// test.mjs — the suite. Run: node test.mjs
//
// The load-bearing claim here is a claim about a MEASURE: that containment is right for contamination
// and Jaccard is wrong. So the suite proves it directly — the same verbatim copy is scored both ways
// against a growing corpus, and Jaccard is shown collapsing toward zero while containment holds at 1.
// A test suite that only checked "the function returns a number" would pass on the buggy version.
import {
  normalise, words, shingles, containment, jaccard, h64, signature,
  estimateJaccard, estimateContainment, DEFAULT_N, DEFAULT_K,
} from './shingle.mjs';
import {
  EXACT, NEAR, PARTIAL, CLEAN, VERDICTS, DEFAULTS,
  makeReference, checkItem, checkSet, internalDuplicates, impact,
} from './contaminate.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.error(`  FAIL  ${name}${extra ? ' · ' + extra : ''}`); } };
const throws = (name, fn, match) => {
  try { fn(); ok(name, false, 'expected a throw'); }
  catch (e) { ok(name, match ? String(e.message).includes(match) : true, e.message.slice(0, 90)); }
};
const S = (t, n = DEFAULT_N) => shingles(t, n);
const sigStr = sig => sig.map(String).join(',');   // BigInt is not JSON-serialisable

// ── 1 · normalisation ───────────────────────────────────────────────────────────────────────
ok('normalise · lowercases', normalise('ABC Def') === 'abc def');
ok('normalise · collapses whitespace', normalise('a   b\n\nc') === 'a b c');
ok('normalise · strips punctuation', normalise('a, b. c!') === 'a b c');
ok('normalise · keeps digits', normalise('item 42') === 'item 42');
ok('normalise · normalises curly quotes', normalise('it’s') === "it's");
ok('normalise · normalises curly double quotes', normalise('“x”') === '"x"');
ok('normalise · trims', normalise('  a  ') === 'a');
ok('normalise · handles null', normalise(null) === '');
ok('normalise · handles undefined', normalise(undefined) === '');
ok('words · splits on whitespace', words('a b  c').length === 3);
ok('words · drops empties', words('   ').length === 0);

// ── 2 · shingling ───────────────────────────────────────────────────────────────────────────
ok('shingles · produces the right count', S('a b c d e', 3).size === 3);
ok('shingles · are word n-grams', S('a b c', 2).has('a b') && S('a b c', 2).has('b c'));
ok('shingles · of empty text is empty', S('', 3).size === 0);
// A short item copied verbatim must not be trivially "clean" — so a short text yields one shingle.
ok('shingles · text shorter than n yields one whole-text shingle', S('a b', 8).size === 1);
ok('shingles · that single shingle is the whole text', S('a b', 8).has('a b'));
ok('shingles · text of exactly n yields one shingle', S('a b c', 3).size === 1);
ok('shingles · text of n+1 yields two', S('a b c d', 3).size === 2);
ok('shingles · a repeated n-gram is deduped by the set', S('a b a b a b', 2).size === 2);
ok('shingles · n below 1 is clamped', S('a b c', 0).size >= 1);
ok('shingles · ignores punctuation differences', S('a, b. c', 2).has('a b'));

// ── 3 · THE MEASURE · containment holds where Jaccard collapses ──────────────────────────────
{
  const item = 'the quick brown fox jumps over the lazy dog and keeps running';
  const filler = i => `unrelated corpus sentence number ${i} about entirely different subject matter here`;

  const results = [1, 10, 100].map(n => {
    const corpus = [item, ...Array.from({ length: n }, (_, i) => filler(i))].join(' . ');
    const a = S(item), b = S(corpus);
    return { n, c: containment(a, b), j: jaccard(a, b) };
  });

  ok('measure · containment is 1 for a verbatim copy, whatever the corpus size',
    results.every(r => Math.abs(r.c - 1) < 1e-12), JSON.stringify(results.map(r => r.c)));
  ok('measure · Jaccard COLLAPSES as the corpus grows around the same copy',
    results[0].j > results[1].j && results[1].j > results[2].j, JSON.stringify(results.map(r => r.j.toFixed(4))));
  ok('measure · Jaccard would report a verbatim copy as barely similar', results[2].j < 0.2, `j=${results[2].j}`);
  ok('measure · containment would not', results[2].c === 1);
}
ok('containment · is 0 for an empty item', containment(new Set(), S('a b c', 2)) === 0);
ok('containment · is 0 for no overlap', containment(S('a b c', 2), S('x y z', 2)) === 0);
ok('containment · is partial for partial overlap',
  (() => { const c = containment(S('a b c d', 2), S('a b z z', 2)); return c > 0 && c < 1; })());
ok('containment · is NOT symmetric', containment(S('a b', 2), S('a b c d', 2)) !== containment(S('a b c d', 2), S('a b', 2)));
ok('jaccard · IS symmetric', jaccard(S('a b c', 2), S('a b', 2)) === jaccard(S('a b', 2), S('a b c', 2)));
ok('jaccard · of two empty sets is 1', jaccard(new Set(), new Set()) === 1);
ok('jaccard · of identical sets is 1', jaccard(S('a b c', 2), S('a b c', 2)) === 1);
ok('jaccard · of disjoint sets is 0', jaccard(S('a b', 2), S('x y', 2)) === 0);

// ── 4 · MinHash ─────────────────────────────────────────────────────────────────────────────
ok('hash · is deterministic', h64('abc') === h64('abc'));
ok('hash · differs for different input', h64('abc') !== h64('abd'));
{
  const a = S('the quick brown fox jumps over the lazy dog', 3);
  const b = S('the quick brown fox leaps over the lazy dog', 3);
  ok('signature · has the requested length', signature(a, 64).length === 64);
  ok('signature · is deterministic', sigStr(signature(a, 32)) === sigStr(signature(a, 32)));
  ok('signature · of identical sets is identical', sigStr(signature(a, 32)) === sigStr(signature(S('the quick brown fox jumps over the lazy dog', 3), 32)));
  ok('estimateJaccard · of a set with itself is 1', estimateJaccard(signature(a, 128), signature(a, 128)) === 1);
  const est = estimateJaccard(signature(a, 512), signature(b, 512));
  const exact = jaccard(a, b);
  ok('estimateJaccard · approximates the exact value', Math.abs(est - exact) < 0.12, `est=${est.toFixed(3)} exact=${exact.toFixed(3)}`);
  throws('estimateJaccard · rejects mismatched signature lengths', () => estimateJaccard([1n], [1n, 2n]), 'same length');
  ok('estimateJaccard · of empty signatures is 0', estimateJaccard([], []) === 0);
}
{
  // the conversion from estimated Jaccard to estimated containment
  const item = S('alpha beta gamma delta epsilon zeta eta theta', 3);
  const corpus = S('alpha beta gamma delta epsilon zeta eta theta ' + Array.from({ length: 40 }, (_, i) => `filler${i} words${i} here${i}`).join(' '), 3);
  const estC = estimateContainment(signature(item, 512), signature(corpus, 512), item.size, corpus.size);
  const exactC = containment(item, corpus);
  ok('estimateContainment · approximates exact containment for a contained item',
    Math.abs(estC - exactC) < 0.2, `est=${estC.toFixed(3)} exact=${exactC.toFixed(3)}`);
  ok('estimateContainment · is high where Jaccard is low',
    estC > 0.6 && estimateJaccard(signature(item, 512), signature(corpus, 512)) < 0.4);
  ok('estimateContainment · is 0 for an empty item', estimateContainment([], [], 0, 10) === 0);
  ok('estimateContainment · is 0 when nothing matches',
    estimateContainment(signature(S('x y z', 2), 64), signature(S('p q r', 2), 64), 2, 2) === 0);
  ok('estimateContainment · never exceeds 1',
    estimateContainment(signature(item, 256), signature(item, 256), item.size, item.size) <= 1);
}

// ── 5 · detection ───────────────────────────────────────────────────────────────────────────
const CORPUS = [
  'the capital of france is paris and it sits on the river seine in the north',
  'photosynthesis converts light energy into chemical energy stored in glucose molecules',
  'entirely unrelated filler about shipping logistics and container throughput at port',
];
const ref = makeReference(CORPUS, { n: 5 });

ok('reference · counts its documents', ref.docs === 3);
ok('reference · holds shingles in exact mode', ref.shingles instanceof Set && ref.size > 0);
ok('reference · holds no signature in exact mode', ref.signature === null);
ok('reference · accepts objects with a text field', makeReference([{ text: 'a b c d e f' }], { n: 3 }).size > 0);

ok('detect · a verbatim item is EXACT',
  checkItem('the capital of france is paris and it sits on the river seine in the north', ref, { n: 5 }).verdict === EXACT);
ok('detect · EXACT sets the verbatim flag',
  checkItem('the capital of france is paris and it sits on the river seine in the north', ref).verbatim === true);
ok('detect · a verbatim item survives reformatting',
  checkItem('The Capital of France is PARIS, and it sits on the River Seine in the north!', ref).verdict === EXACT);
ok('detect · an unrelated item is CLEAN',
  checkItem('quantum chromodynamics describes the strong nuclear interaction between quarks', ref).verdict === CLEAN);
ok('detect · CLEAN is not contaminated',
  checkItem('quantum chromodynamics describes the strong nuclear interaction between quarks', ref).contaminated === false);
ok('detect · EXACT is contaminated',
  checkItem(CORPUS[0], ref).contaminated === true);
ok('detect · a partial fragment scores between the thresholds', (() => {
  const r = checkItem('photosynthesis converts light energy into chemical energy but then diverges completely into unrelated territory here', ref, { n: 5 });
  return r.containment > 0 && r.containment < 1;
})());
ok('detect · an empty item is CLEAN', checkItem('', ref).verdict === CLEAN);
ok('detect · reports the item id when given one',
  checkItem({ id: 'q1', text: CORPUS[0] }, ref).id === 'q1');
ok('detect · reports null id for a bare string', checkItem(CORPUS[0], ref).id === null);
ok('detect · reports the shingle count', checkItem(CORPUS[0], ref).shingles > 0);

// thresholds, at the boundary
{
  const item = 'aa bb cc dd ee ff gg hh ii jj';
  const partialCorpus = 'aa bb cc dd ee zz zz zz zz zz';
  const r2 = makeReference([partialCorpus], { n: 2 });
  const c = checkItem(item, r2, { n: 2 }).containment;
  ok('detect · a threshold set exactly at the containment still classifies NEAR',
    checkItem(item, r2, { n: 2, near: c }).verdict === NEAR, `containment=${c}`);
  ok('detect · a threshold just above the containment drops it to PARTIAL',
    checkItem(item, r2, { n: 2, near: c + 1e-9, partial: 0 }).verdict === PARTIAL);
  ok('detect · a partial threshold above the containment gives CLEAN',
    checkItem(item, r2, { n: 2, near: 1.1, partial: c + 1e-9 }).verdict === CLEAN);
  ok('detect · a partial threshold exactly at the containment gives PARTIAL',
    checkItem(item, r2, { n: 2, near: 1.1, partial: c }).verdict === PARTIAL);
}

// estimate mode
{
  const est = makeReference(CORPUS, { n: 5, estimate: true, k: 256 });
  ok('reference · estimate mode holds a signature, not shingles', est.signature !== null && est.shingles === null);
  const r = checkItem(CORPUS[0], est, { n: 5 });
  ok('detect · estimate mode flags a copied item as contaminated', r.contaminated === true, `c=${r.containment}`);
  ok('detect · estimate mode marks the result estimated', r.estimated === true);
  ok('detect · estimate mode cannot claim verbatim', r.verbatim === false);
  ok('detect · estimate mode leaves an unrelated item clean',
    checkItem('quantum chromodynamics describes the strong nuclear interaction', est, { n: 5 }).verdict === CLEAN);
}

// whole set
{
  const items = [
    { id: 'a', text: CORPUS[0] },
    { id: 'b', text: 'quantum chromodynamics describes the strong nuclear interaction between quarks' },
    { id: 'c', text: CORPUS[1] },
  ];
  const check = checkSet(items, ref, { n: 5 });
  ok('checkSet · reports one result per item', check.results.length === 3);
  ok('checkSet · counts contaminated items', check.contaminated === 2);
  ok('checkSet · reports a rate', Math.abs(check.rate - 2 / 3) < 1e-12);
  ok('checkSet · counts every verdict class', VERDICTS.every(v => typeof check.counts[v] === 'number'));
  ok('checkSet · the counts sum to the total', VERDICTS.reduce((s, v) => s + check.counts[v], 0) === 3);
  ok('checkSet · describes the reference it used', check.reference.docs === 3 && check.reference.n === 5);
  ok('checkSet · an empty item list yields a zero rate', checkSet([], ref).rate === 0);
}

// ── 6 · internal duplication ────────────────────────────────────────────────────────────────
{
  const items = [
    { id: 'x', text: 'the quick brown fox jumps over the lazy dog today' },
    { id: 'y', text: 'the quick brown fox jumps over the lazy dog today' },
    { id: 'z', text: 'completely different content about maritime shipping containers' },
  ];
  const dupes = internalDuplicates(items, { n: 3 });
  ok('duplicates · identical items are found', dupes.length === 1 && dupes[0].similarity === 1);
  ok('duplicates · names both sides', dupes[0].a === 'x' && dupes[0].b === 'y');
  ok('duplicates · unrelated items are not paired', !dupes.some(d => d.a === 'z' || d.b === 'z'));
  ok('duplicates · a high threshold finds nothing', internalDuplicates(items, { n: 3, threshold: 1.01 }).length === 0);
  ok('duplicates · falls back to positional ids', internalDuplicates(['a b c d', 'a b c d'], { n: 2 })[0].a === 'item-0');
  ok('duplicates · a single item has no pairs', internalDuplicates([{ id: 'q', text: 'a b c' }]).length === 0);
}

// ── 7 · IMPACT · the part that matters ──────────────────────────────────────────────────────
{
  const items = [
    { id: 'a', text: CORPUS[0] },   // contaminated, scores high
    { id: 'b', text: CORPUS[1] },   // contaminated, scores high
    { id: 'c', text: 'quantum chromodynamics describes the strong nuclear interaction' },
    { id: 'd', text: 'an entirely separate question about tidal patterns and lunar cycles' },
  ];
  const check = checkSet(items, ref, { n: 5 });
  const scores = { a: 10, b: 10, c: 2, d: 2 };
  const imp = impact(check, scores);
  ok('impact · drops the contaminated items', imp.itemsDropped === 2);
  ok('impact · keeps the rest', imp.itemsKept === 2);
  ok('impact · names what it dropped', imp.droppedIds.join() === 'a,b');
  ok('impact · reports the headline before', imp.before === 6);
  ok('impact · reports the headline after', imp.after === 2);
  ok('impact · reports the delta', imp.delta === -4);
  ok('impact · calls a large move material', imp.material === true);
  ok('impact · records the drop rule it applied', imp.dropRule.join() === 'EXACT,NEAR');

  const noMove = impact(check, { a: 5, b: 5, c: 5, d: 5 });
  ok('impact · a headline that does not move is not material', noMove.delta === 0 && noMove.material === false);

  // per-axis, when the grades are konomi-rubric vectors
  const vectors = {
    a: [4, 0, 0, 0, 0, 0, 0], b: [4, 0, 0, 0, 0, 0, 0],
    c: [0, 0, 0, 0, 0, 1, 0], d: [0, 0, 0, 0, 0, 1, 0],
  };
  const vimp = impact(check, vectors);
  ok('impact · reports per-axis movement for vector scores', Array.isArray(vimp.perAxis) && vimp.perAxis.length === 7);
  ok('impact · shows the axis the leak inflated', vimp.perAxis[0].delta < 0);
  ok('impact · shows the axis it did not', vimp.perAxis[5].delta > 0);
  // mean over all four = [2,0,0,0,0,0.5,0] → 2.5 ; over the two kept = [0,0,0,0,0,1,0] → 1
  ok('impact · totals the vector into the headline', vimp.before === 2.5 && vimp.after === 1);
  ok('impact · the vector headline moved down once the leaked items went', vimp.delta === -1.5);

  ok('impact · a custom drop rule is honoured',
    impact(check, scores, { drop: [EXACT] }).dropRule.join() === 'EXACT');
  ok('impact · dropping nothing leaves the headline alone',
    impact(check, scores, { drop: [] }).delta === 0);
  ok('impact · ignores items with no score', impact(check, { a: 10 }).itemsAll === 1);
  ok('impact · reports null when everything was dropped',
    impact(check, { a: 10, b: 10 }).after === null && impact(check, { a: 10, b: 10 }).delta === null);
}

// ── 8 · boundaries and degenerate inputs ────────────────────────────────────────────────────
// Written because a mutant survived without them. Thresholds and short-input edges are where a
// contamination checker quietly starts answering "clean" to everything.

// shingling · the length boundary that decides whether a short item can be caught at all
ok('shingles · text of exactly n takes the whole-text path, not the sliding one', S('a b c', 3).size === 1 && S('a b c', 3).has('a b c'));
ok('shingles · text of n-1 also yields the whole text', S('a b', 3).has('a b'));
ok('shingles · text of n+1 slides and yields two distinct grams',
  (() => { const s = S('a b c d', 3); return s.size === 2 && s.has('a b c') && s.has('b c d'); })());

// jaccard · both sides empty is the only case that is 1 by definition
ok('jaccard · an empty set against a non-empty one is 0', jaccard(new Set(), S('a b c', 2)) === 0);
ok('jaccard · a non-empty set against an empty one is 0', jaccard(S('a b c', 2), new Set()) === 0);

// minhash · signature length and the min-selection
ok('signature · k of 1 still produces a signature', signature(S('a b c', 2), 1).length === 1);
ok('signature · a larger set never yields a longer signature', signature(S('a b c d e f g h', 2), 16).length === 16);
ok('signature · picks the MINIMUM, so adding a shingle can only lower a position',
  (() => {
    const small = signature(S('alpha beta gamma', 2), 16);
    const bigger = signature(S('alpha beta gamma delta epsilon zeta', 2), 16);
    return bigger.every((v, i) => v <= small[i]);
  })());
ok('estimateContainment · a size of zero yields zero', estimateContainment([1n], [1n], 0, 5) === 0);
ok('estimateContainment · a negative size yields zero', estimateContainment([1n], [1n], -1, 5) === 0);

// makeReference · a document that is neither a string nor { text }
ok('reference · a doc with no text field contributes nothing rather than "undefined"',
  makeReference([{ notText: 'x' }], { n: 2 }).size === 0);
ok('reference · a null doc is tolerated', makeReference([null], { n: 2 }).size === 0);
ok('reference · mixed string and object docs both contribute',
  makeReference(['a b c d', { text: 'e f g h' }], { n: 2 }).size === 6);

// internalDuplicates · threshold boundary and ordering
{
  const items = [
    { id: 'p', text: 'alpha beta gamma delta epsilon' },
    { id: 'q', text: 'alpha beta gamma delta omega' },
    { id: 'r', text: 'alpha beta gamma delta epsilon' },
  ];
  const sim = internalDuplicates(items, { n: 2, threshold: 0 }).find(d => d.a === 'p' && d.b === 'q').similarity;
  ok('duplicates · a threshold exactly at the similarity still pairs them',
    internalDuplicates(items, { n: 2, threshold: sim }).some(d => d.a === 'p' && d.b === 'q'));
  ok('duplicates · a threshold just above it does not',
    !internalDuplicates(items, { n: 2, threshold: sim + 1e-9 }).some(d => d.a === 'p' && d.b === 'q'));
  ok('duplicates · are ordered most-similar first',
    (() => { const d = internalDuplicates(items, { n: 2, threshold: 0 }); return d[0].similarity >= d[d.length - 1].similarity; })());
  ok('duplicates · the identical pair outranks the merely similar one',
    internalDuplicates(items, { n: 2, threshold: 0 })[0].similarity === 1);
  ok('duplicates · a single item never pairs with itself', internalDuplicates([{ id: 'solo', text: 'a b c d' }], { n: 2 }).length === 0);
}

// impact · the material threshold, and the vector/scalar branch
{
  const items = [{ id: 'a', text: CORPUS[0] }, { id: 'c', text: 'unrelated content about tides' }];
  const check = checkSet(items, ref, { n: 5 });
  // before = 10, after = 5 → |delta/before| = 0.5
  const big = impact(check, { a: 15, c: 5 });
  ok('impact · a 50% move is material', big.material === true);
  // before = (100+95)/2 = 97.5, after = 95 → 2.6%, under the 5% mark
  const small = impact(check, { a: 100, c: 95 });
  ok('impact · a move under the reporting threshold is not called material', small.material === false, `delta=${small.delta}`);
  // before = (105+95)/2 = 100, after = 95 → exactly 5%, which is ON the threshold and counts
  ok('impact · a move sitting exactly on the threshold IS material',
    impact(check, { a: 105, c: 95 }).material === true);
  // A headline of zero cannot have a percentage movement. Dividing by it yields Infinity, which
  // would report every such case as material — so the zero is checked, not divided by.
  ok('impact · a before of zero is not called material rather than dividing by it',
    impact(check, { a: 0, c: 0 }).material === false);
  ok('impact · a zero headline with real movement is still not material',
    (() => { const i = impact(check, { a: -5, c: 5 }); return i.before === 0 && i.delta === 5 && i.material === false; })());

  // a single scalar score must not be mistaken for a vector, and vice versa
  ok('impact · a scalar score set reports no per-axis breakdown', impact(check, { a: 1, c: 1 }).perAxis === null);
  ok('impact · a vector score set does report one',
    Array.isArray(impact(check, { a: [1,0,0,0,0,0,0], c: [1,0,0,0,0,0,0] }).perAxis));
  ok('impact · an empty score set reports no per-axis breakdown', impact(check, {}).perAxis === null);
  ok('impact · an empty score set reports null before and after',
    impact(check, {}).before === null && impact(check, {}).after === null);
  ok('impact · dropping everything leaves no per-axis breakdown either',
    impact(check, { a: [1,0,0,0,0,0,0] }).perAxis === null);
}

console.log(`\nkonomi-clean · ${pass}/${pass + fail} passed`);
if (fail) { console.error(`${fail} FAILED`); process.exit(1); }
