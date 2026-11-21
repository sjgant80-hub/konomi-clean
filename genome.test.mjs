// genome.test.mjs — konomi-clean as a cell of the estate genome: its judge, its lane and its health.
// Run: node genome.test.mjs   (same plain runner as test.mjs: prints a count, exits 1 on any failure)
import { readFileSync } from 'node:fs';
import { judge, inLane, health, verdict, isText } from './genome/cell.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.error(`  FAIL  ${name}${extra ? ' · ' + extra : ''}`); } };
// an async answer is compared only when it resolves: a throw is a failure, never a pass
const is = async (name, p, want) => {
  let got;
  try { got = await p; } catch (e) { ok(name, false, 'threw: ' + String(e && e.message).slice(0, 90)); return; }
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
};

const seed = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8'));
const CORPUS = seed.judge.cases.good.reference;   // the CORPUS fixture from test.mjs
const COPY = seed.judge.cases.good.item;          // its first document, reformatted
const UNRELATED = seed.boundary.inLane.item;      // the unrelated fixture from test.mjs
// one extra word at the end: no longer a verbatim copy, but 9 of its 10 eight-word shingles are in the corpus
const NEARLY = CORPUS[0] + ' today';
// a whole short document, then three words of something else: 4 of its 7 eight-word shingles are in the corpus
const HALF = CORPUS[1] + ' then something else';

// ── the seed's own cases ──
await is('seed · the good case (a reformatted copy called EXACT) is verified', judge(seed.judge.cases.good), 'verified');
await is('seed · the bad case (the same copy claimed CLEAN) is unverified', judge(seed.judge.cases.bad), 'unverified');
ok('seed · the copy really is reformatted, so a plain string match would miss it', !CORPUS.includes(COPY.text));

// ── the judge reads with the kernel, verdict by verdict ──
ok('verdict · the reformatted copy is EXACT', verdict({ item: COPY, reference: CORPUS }) === 'EXACT');
ok('verdict · one extra word is NEAR', verdict({ item: NEARLY, reference: CORPUS }) === 'NEAR');
ok('verdict · half a document is PARTIAL', verdict({ item: HALF, reference: CORPUS }) === 'PARTIAL');
ok('verdict · the unrelated item is CLEAN', verdict({ item: UNRELATED, reference: CORPUS }) === 'CLEAN');
await is('judge · NEAR claimed NEAR is verified', judge({ item: NEARLY, reference: CORPUS, claim: 'NEAR' }), 'verified');
await is('judge · NEAR claimed EXACT is unverified', judge({ item: NEARLY, reference: CORPUS, claim: 'EXACT' }), 'unverified');
await is('judge · PARTIAL claimed PARTIAL is verified', judge({ item: HALF, reference: CORPUS, claim: 'PARTIAL' }), 'verified');
await is('judge · CLEAN claimed CLEAN is verified', judge({ item: UNRELATED, reference: CORPUS, claim: 'CLEAN' }), 'verified');
await is('judge · CLEAN claimed PARTIAL is unverified', judge({ item: UNRELATED, reference: CORPUS, claim: 'PARTIAL' }), 'unverified');
await is('judge · a bare-string item is judged the same way', judge({ item: COPY.text, reference: CORPUS, claim: 'EXACT' }), 'verified');
await is('judge · reference documents may be {text} objects', judge({ item: COPY, reference: CORPUS.map((text) => ({ text })), claim: 'EXACT' }), 'verified');

// ── refusals ──
for (const [name, x] of [
  ['a claim that is not a verdict', { item: COPY, reference: CORPUS, claim: 'DIRTY' }],
  ['a lower-case verdict', { item: COPY, reference: CORPUS, claim: 'exact' }],
  ['no claim', { item: COPY, reference: CORPUS }],
  ['no corpus, even with a real claim', { item: COPY, claim: 'CLEAN' }],
  ['null', null], ['a string', 'x'], ['an empty object', {}],
]) await is(`judge · refuses ${name}`, judge(x), 'refused');

// ── the lane ──
await is('lane · the seed in-lane sample is taken', inLane(seed.boundary.inLane), true);
await is('lane · the seed out-of-lane sample (a corpus that is one word, not documents) is refused', inLane(seed.boundary.outOfLane), false);
await is('lane · an empty corpus is out of lane', inLane({ item: COPY, reference: [] }), false);
await is('lane · a corpus with one document is in lane', inLane({ item: COPY, reference: [CORPUS[0]] }), true);
await is('lane · a corpus holding a blank document is out of lane', inLane({ item: COPY, reference: [CORPUS[0], '  '] }), false);
await is('lane · an item that is only punctuation is out of lane', inLane({ item: '?!', reference: CORPUS }), false);
await is('lane · an item with no text is out of lane', inLane({ item: { id: 'q9' }, reference: CORPUS }), false);
await is('lane · null is out of lane', inLane(null), false);
ok('isText · a string and a {text} both count', isText('a b') === true && isText({ text: 'a b' }) === true);
ok('isText · numbers, null and empty text do not', [5, null, undefined, '', '...', { text: 5 }].every((x) => isText(x) === false));

// ── health ──
await is('health · says what it cannot measure from inside the repository', health(), { used: null, dependedOn: null, lastEarned: null });

console.log(`\nkonomi-clean genome · ${pass}/${pass + fail} passed`);
if (fail) { console.error(`${fail} FAILED`); process.exit(1); }
