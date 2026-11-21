// cell.mjs — konomi-clean's three answers for the birth check (seed.json, genome/).
//
// judge  a claimed contamination verdict for an evaluation item is verified when konomi-clean's own checkItem(), at its
//        default shingle size and thresholds, gives the same verdict against the same reference corpus. Unverified
//        when it does not. Refused when the input is out of lane, or the claim is not one of EXACT, NEAR, PARTIAL or
//        CLEAN. The birth check's bad case is the failure this repository exists to stop: an item copied into the
//        corpus (reformatted, so a naive string match misses it) claimed CLEAN.
// lane   an item with some text left after normalising (a string, or {id, text}) and a non-empty list of reference
//        documents, each a text the same way. An item with no corpus to check against is out of lane and goes to Kar.
import { checkItem, makeReference, VERDICTS } from '../contaminate.mjs';
import { normalise } from '../shingle.mjs';

const textOf = (x) => (typeof x === 'string' ? x : x?.text);

// isText(x) → true when x is a text (or {text}) that still says something once case, punctuation and spacing go
export const isText = (x) => typeof textOf(x) === 'string' && normalise(textOf(x)) !== '';

// verdict(input) → the kernel's own verdict for the item against the corpus
export const verdict = (input) => checkItem(input.item, makeReference(input.reference)).verdict;

export async function judge(input) {
  if (!(await inLane(input)) || !VERDICTS.includes(input.claim)) return 'refused';
  return verdict(input) === input.claim ? 'verified' : 'unverified';
}

export async function inLane(input) {
  return isText(input?.item) && Array.isArray(input?.reference) && input.reference.length > 0 && input.reference.every(isText);
}

// health: konomi-clean is a library and a page; from inside the repository it cannot see who checks their benchmarks
// with it or when it last caught a leaked item, so it says so
export async function health() {
  return { used: null, dependedOn: null, lastEarned: null };
}
